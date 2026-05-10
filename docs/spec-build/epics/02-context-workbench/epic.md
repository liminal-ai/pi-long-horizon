# Epic 2: Context Workbench

This epic defines the complete requirements for the Context Workbench. It serves as the Feature 2 epic requirements.

---

## Onboarding Context

PI Long Horizon stores a complete source Thread and derives lower-fidelity context layers from it over time. A Thread remains the source of truth. A Thread View is a curated context expression of that Thread for runtime use or review. It assembles source material into explicit bands using raw turns, smooth turns, and chunk summaries, and it is the runtime-facing context that later smart compact work rebuilds. One Thread can have many Thread Views. Exactly one Thread View is active at a time.

The Context Workbench is the surface where the steward understands source context, understands active and draft Thread Views, and curates new Thread Views for future use. Search, skimming, and inspection matter because they support good editing decisions. The workbench is not a passive browser.

---

## User Profile

**Primary User:** Context Steward

**Context:** The steward manages long-running PI coding sessions whose useful context is larger than a raw transcript. The steward needs to find relevant source material quickly, understand how that material is currently represented, and build or revise Thread Views without mutating source truth.

**Mental Model:** "The Thread is the full history. A Thread View is a curated working context built from that history. I need to inspect the history, choose what belongs in each band, and shape the next usable view."

**Key Constraint:** Good Thread View editing depends on fast access to source messages, turns, and lower-fidelity artifacts without confusing source truth with curated view state.

**Secondary Users:** The human operator inspects thread state, reviews draft Thread Views, and makes bespoke context decisions. Future deterministic code and future agents consume the same workbench concepts.

---

## Feature Overview

The Context Workbench gives the steward a search, inspection, and curation surface over Threads and Thread Views. It supports finding messages and turns quickly, skimming large result sets, opening full detail when needed, creating empty draft Thread Views, filling the draft's band regions from source truth, excluding turns from a view, comparing draft and active views, and activating a new view without mutating source records.

The workbench understands the full four-band model used by later compaction and projection work:

- full fidelity band
- smooth band
- detailed chunk band
- brief chunk band

Feature 2 makes those bands navigable and editable as Thread View composition objects. It does not own the full async maintenance pipeline or the final smart compact runtime orchestration.

Flow summary:

- [Thread And Active View Inspection](#1-thread-and-active-view-inspection): open a Thread, inspect its active Thread View, understand whether the thread is ready for stewardship work, and read fixture Threads through the same surface. AC: `1.1-1.5`
- [Search And Skim](#2-search-and-skim): search messages, turns, and Thread Views; skim large result sets with high-signal summaries. AC: `2.1-2.4`
- [Detailed Inspection And Pivots](#3-detailed-inspection-and-pivots): open full detail for a message, turn, Thread View, or chunk and move between related records. AC: `3.1-3.4`
- [Draft Thread View Lifecycle](#4-draft-thread-view-lifecycle): create an empty draft Thread View from source truth, track active/draft/archived states, preserve one-active-view invariants, and archive drafts that will not be activated. AC: `4.1-4.5`
- [Upper-Band Composition](#5-upper-band-composition): fill full-fidelity and smooth bands from turn selections, preserve turn boundaries, and support turn-level exclusion. AC: `5.1-5.5`
- [Lower-Band Awareness](#6-lower-band-awareness): represent detailed and brief bands through chunk-backed selections, keep open chunks out of lower bands, and surface lower-band readiness. AC: `6.1-6.4`
- [View Comparison And Activation](#7-view-comparison-and-activation): compare draft and active views, activate a prepared draft, and archive prior active views. AC: `7.1-7.4`

---

## Scope

### In Scope

- Thread-level inspection with source-vs-view distinction.
- Thread View records with `active`, `draft`, and `archived` states.
- Search across messages, turns, and Thread Views.
- Skim-friendly summary rows for large result sets.
- Full detail views for messages, turns, Thread Views, and minimally for chunks.
- Draft Thread View creation from source truth.
- Explicit four-band Thread View structure.
- Turn-based selection for full-fidelity and smooth bands.
- Turn-level exclusion from a Thread View.
- Minimal chunk visibility and lower-band readiness signals.
- Draft-vs-active comparison.
- Activation of a draft Thread View and archival of the prior active view.
- Workbench-readable fixture Threads.

### Out of Scope

- Full smart compact execution and PI reload orchestration. Feature 3.
- Smooth generation. Feature 3 and Feature 4.
- Chunk boundary adjudication workflow and chunk maintenance control plane. Feature 3 and Feature 4.
- Detailed and brief summary generation. Feature 4.
- Full async dependency-graph or retry-chain inspection. Future work after Feature 3.
- Message-level exclusion from Thread Views.
- Deleting draft Thread Views. Archival is the in-scope abandonment path.
- Full chunk editing or chunk boundary editing.
- Web UI. Future direction.
- Non-PI target compilers. Future direction.

### Assumptions

| ID | Assumption | Status | Owner | Notes |
|----|------------|--------|-------|-------|
| A1 | A Thread can support many Thread Views while maintaining exactly one active Thread View. | Unvalidated | Tech Lead | Validate persistence and activation semantics during design. |
| A2 | Draft Thread Views should be created empty and then filled from source truth rather than copied from an existing Thread View. | Unvalidated | Product + Tech Lead | Later implementation may optimize from an existing view, but source truth remains authoritative. |
| A3 | Full-fidelity and smooth band selection should preserve turn boundaries. | Validated from product and architecture direction | Product | Message-level splitting is explicitly deferred. |
| A4 | Closed chunks can be minimally visible in Feature 2 even if full chunk workflows remain Feature 3. | Unvalidated | Tech Lead | Keep chunk visibility minimal if supporting artifacts are incomplete. |
| A5 | Lower-band composition should use closed chunks only. Open chunk content remains in the smooth band until chunk closure occurs. | Validated from product direction | Product | This is a composition invariant for Feature 2. |
| A6 | The workbench should expose existing readiness and blocker state, but not the full async dependency chain that produces it. | Validated from product direction | Product | Full dependency-chain visibility is deferred. |

---

## Flows & Requirements

### 1. Thread And Active View Inspection

The steward opens a Thread and needs immediate orientation. The workbench shows the thread's source identity, the active Thread View, the current state of each band, and whether the thread is currently usable for further curation work.

1. Steward opens a Thread in the workbench.
2. Workbench reads thread identity and status.
3. Workbench reads the active Thread View for that Thread.
4. Workbench shows source-thread status and active-view status side by side.
5. Steward determines whether to inspect, search, or begin a new draft view.

#### Acceptance Criteria

**AC-1.1:** Using the workbench, the steward can distinguish source Thread state from active Thread View state.

- **TC-1.1a: Source and active view are shown separately**
  - Given: A Thread has an active Thread View
  - When: The workbench opens the Thread
  - Then: The source Thread identity and the active Thread View identity are both visible as separate records
- **TC-1.1b: Thread without active view remains readable**
  - Given: A Thread exists and no active Thread View exists
  - When: The workbench opens the Thread
  - Then: The source Thread is still readable and the absence of an active Thread View is explicit

**AC-1.2:** Using the workbench, the steward can see whether the Thread is currently usable for stewardship work.

- **TC-1.2a: Ready thread reports usable status**
  - Given: A Thread has no known blockers for current workbench operations
  - When: The workbench opens the Thread
  - Then: The Thread is shown as usable
- **TC-1.2b: Blocked or degraded thread reports why**
  - Given: A Thread has known blocked or degraded maintenance state
  - When: The workbench opens the Thread
  - Then: The workbench shows the blocked or degraded status and names the blocker at a reader-usable level

**AC-1.3:** Using the workbench, the steward can inspect the active Thread View's band structure.

- **TC-1.3a: Active view band regions are visible**
  - Given: An active Thread View exists
  - When: The workbench opens the Thread
  - Then: The active Thread View shows full-fidelity, smooth, detailed, and brief band regions in order
- **TC-1.3b: Empty band is explicit**
  - Given: A Thread View has no content in one or more bands
  - When: The Thread View is opened
  - Then: Empty bands are shown explicitly rather than omitted silently

**AC-1.4:** Using the workbench, the steward can list all Thread Views for a Thread with their current state.

- **TC-1.4a: Active, draft, and archived views are listed**
  - Given: A Thread has multiple Thread Views in different states
  - When: The workbench opens the Thread
  - Then: All Thread Views are listed with their current state
- **TC-1.4b: One active view invariant is visible**
  - Given: A Thread has an active Thread View
  - When: The workbench lists Thread Views
  - Then: Exactly one Thread View is shown as active

**AC-1.5:** Using the workbench, the steward can open fixture Threads as normal Thread-shaped records.

- **TC-1.5a: Fixture Thread opens through the same inspection surface**
  - Given: A fixture Thread exists
  - When: The steward opens the fixture in the workbench
  - Then: The fixture is readable through the same inspection flow used for normal Threads

### 2. Search And Skim

The steward needs to find relevant context quickly. The workbench supports search across source records and Thread Views, and it returns skim-friendly results that help the steward decide what to open next. Search includes content queries and metadata-based filters. Minimum metadata filters are message kind, actor type, and source-order range for messages; turn lifecycle status and turn-order range for turns; and state, name, and purpose for Thread Views.

1. Steward enters a search or chooses a result list.
2. Workbench searches the selected record classes.
3. Workbench returns ordered results with compact summaries.
4. Steward skims the list and selects an item for full inspection.

#### Acceptance Criteria

**AC-2.1:** Using the workbench, the steward can search messages, turns, and Thread Views by content and metadata.

- **TC-2.1a: Message search returns matching messages**
  - Given: A Thread contains searchable message content
  - When: The steward searches messages
  - Then: Matching messages are returned
- **TC-2.1b: Turn search returns matching turns**
  - Given: A Thread contains searchable turn content
  - When: The steward searches turns
  - Then: Matching turns are returned
- **TC-2.1c: Thread View search returns matching views**
  - Given: A Thread has multiple Thread Views with identifiable metadata
  - When: The steward searches Thread Views
  - Then: Matching Thread Views are returned
- **TC-2.1d: Metadata filters narrow results**
  - Given: Searchable records contain filterable metadata
  - When: The steward applies supported metadata filters
  - Then: The result set is narrowed according to those filters

**AC-2.2:** Using the workbench, the steward can skim large result sets through compact, recognizable summaries.

- **TC-2.2a: Message result shows compact high-signal content**
  - Given: Message search returns many matches
  - When: The workbench renders the result list
  - Then: Each result shows leading recognizable content and metadata that help the steward skim quickly
- **TC-2.2b: Turn result shows summary fields rather than raw dump**
  - Given: Turn search returns many matches
  - When: The workbench renders the result list
  - Then: Each result shows a compact summary of the turn rather than the full raw turn payload
- **TC-2.2c: Thread View result shows state and purpose**
  - Given: Thread View search returns many matches
  - When: The workbench renders the result list
  - Then: Each result shows enough metadata to distinguish active, draft, and archived views and their intended use

**AC-2.3:** Using the workbench, the steward can see enough structural context in search results to support decisions.

- **TC-2.3a: Message result includes turn relationship**
  - Given: A message belongs to a Turn
  - When: The message appears in search results
  - Then: The result includes enough metadata to locate the owning Turn
- **TC-2.3b: Turn result includes current band or view relationship when applicable**
  - Given: A Turn is included in one or more Thread Views
  - When: The Turn appears in search results
  - Then: The result includes enough metadata to understand whether it participates in the active or draft view

**AC-2.4:** Using the workbench, the steward can receive long result sets without forcing full-detail rendering.

- **TC-2.4a: Long result set does not require full-detail payloads**
  - Given: A search returns a long list of matches
  - When: The results are rendered
  - Then: The list uses summary forms rather than full-detail forms
- **TC-2.4b: Empty search result is explicit**
  - Given: No records match the search
  - When: The steward submits the query
  - Then: The workbench reports that no results were found

### 3. Detailed Inspection And Pivots

The steward needs to open one item in full detail, understand it, and move to related records without losing context.

1. Steward selects a message, turn, Thread View, or chunk.
2. Workbench renders full detail for that item.
3. Workbench shows links to related records.
4. Steward pivots to the next item needed for the decision at hand.

#### Acceptance Criteria

**AC-3.1:** Using the workbench, the steward can open a message in full detail.

- **TC-3.1a: Full message detail includes all parts**
  - Given: A Message contains multiple typed Parts
  - When: The steward opens the Message
  - Then: The full Message detail includes all parts in order
- **TC-3.1b: Message detail includes source metadata**
  - Given: A Message has source-order and actor metadata
  - When: The steward opens the Message
  - Then: The detail view includes the metadata needed to place the Message back into Thread context

**AC-3.2:** Using the workbench, the steward can open a Turn in full detail.

- **TC-3.2a: Full Turn detail includes its member messages**
  - Given: A Turn contains multiple Messages
  - When: The steward opens the Turn
  - Then: The detail view shows the Turn's member Messages in source order
- **TC-3.2b: Turn detail includes current view relationship when applicable**
  - Given: A Turn is included in one or more Thread Views
  - When: The steward opens the Turn
  - Then: The detail view shows whether the Turn is currently included in the active or draft view and in which band

**AC-3.3:** Using the workbench, the steward can open a Thread View in full detail.

- **TC-3.3a: Thread View detail shows all band regions**
  - Given: A Thread View contains multiple populated bands
  - When: The steward opens the Thread View
  - Then: The detail view shows all band regions in order with their current selected units
- **TC-3.3b: Thread View detail shows emitted context result**
  - Given: A Thread View has a materialized emitted message sequence
  - When: The steward opens the Thread View
  - Then: The steward can inspect the resulting message sequence in addition to the band selections

**AC-3.4:** Using the workbench, the steward can pivot between related records.

- **TC-3.4a: Pivot from message to turn**
  - Given: A Message belongs to a Turn
  - When: The steward opens the Message
  - Then: The steward can move from that Message to its owning Turn
- **TC-3.4b: Pivot from turn to Thread View placement**
  - Given: A Turn appears in one or more Thread Views
  - When: The steward opens the Turn
  - Then: The steward can move from that Turn to the relevant Thread View placement
- **TC-3.4c: Pivot from Thread View band selection to source detail**
  - Given: A Thread View band contains selected turns or chunks
  - When: The steward opens that band selection
  - Then: The steward can move back to the source Turn or chunk detail

### 4. Draft Thread View Lifecycle

The steward needs to create and manage draft Thread Views without mutating the source Thread or violating active-view invariants.

1. Steward creates a new Thread View draft for a Thread.
2. Workbench records draft identity, purpose, and state.
3. Draft begins empty and waits for band composition.
4. Steward may keep, activate, archive, or revisit the draft later.

#### Acceptance Criteria

**AC-4.1:** Using the workbench, the steward can create a new draft Thread View that starts empty.

- **TC-4.1a: Draft view is created with no selected source units**
  - Given: A Thread exists
  - When: The steward creates a new draft Thread View
  - Then: The draft exists with empty band regions
- **TC-4.1b: Empty draft is explicit**
  - Given: A draft Thread View has not yet been filled
  - When: The steward opens the draft
  - Then: The workbench shows that the draft is empty rather than implying inferred content
- **TC-4.1c: Empty source thread still permits draft creation**
  - Given: A Thread exists and has no Turns yet
  - When: The steward creates a draft Thread View
  - Then: The draft is created and remains empty

**AC-4.2:** Using the workbench, the steward can create draft Thread Views from source truth without mutating the source Thread.

- **TC-4.2a: Draft creation does not change source Thread**
  - Given: A Thread contains source Messages and Turns
  - When: The steward creates a draft Thread View
  - Then: The source Thread remains unchanged
- **TC-4.2b: Draft creation does not require copying the active view**
  - Given: A Thread has an active Thread View
  - When: The steward creates a new draft
  - Then: The draft starts as a new empty view associated with the same source Thread

**AC-4.3:** Using the workbench, the steward can distinguish active, draft, and archived Thread View states.

- **TC-4.3a: Draft state is explicit**
  - Given: A Thread View is not active and not archived
  - When: The workbench reads its state
  - Then: The Thread View is shown as draft
- **TC-4.3b: Archived state is explicit**
  - Given: A Thread View has been archived
  - When: The workbench reads its state
  - Then: The Thread View is shown as archived

**AC-4.4:** Using the workbench, the steward can rely on exactly one active Thread View for a Thread at a time.

- **TC-4.4a: Thread with active view lists one active state**
  - Given: A Thread has one active Thread View
  - When: The workbench lists all Thread Views
  - Then: Exactly one is active
- **TC-4.4b: Draft creation does not create a second active view**
  - Given: A Thread already has an active Thread View
  - When: The steward creates a draft
  - Then: The existing active view remains the only active view

**AC-4.5:** Using the workbench, the steward can archive a draft Thread View without activating it.

- **TC-4.5a: Draft can be archived as an abandonment path**
  - Given: A draft Thread View exists and will not be activated
  - When: The steward archives the draft
  - Then: The draft becomes archived and remains readable as an abandoned draft view

### 5. Upper-Band Composition

The steward builds the upper bands of a draft Thread View from source Turns. Full-fidelity and smooth bands use turn selections. Full-fidelity rendering emits raw messages for the selected turns. Smooth rendering emits one synthetic smooth-turn message for each selected Turn, using standardized section markers that preserve user, assistant, tool, and thinking back-and-forth.

1. Steward sets or reviews the target band budgets for the draft Thread View.
2. Steward selects full-fidelity turns from newest backward.
3. Workbench renders those turns as raw messages in the full-fidelity band.
4. Steward selects smooth-band turns from the next older region.
5. Workbench renders those turns as smooth-turn messages.
6. Steward excludes turns when the view needs bespoke curation.

#### Acceptance Criteria

**AC-5.1:** Using the workbench, the steward can compose the full-fidelity band from turn selections while preserving turn boundaries.

- **TC-5.1a: Full-fidelity selection is turn-based**
  - Given: A draft Thread View is being filled
  - When: The steward adds content to the full-fidelity band
  - Then: The selected source units are Turns, not individual Messages
- **TC-5.1b: Full-fidelity band does not split a Turn**
  - Given: A Turn has multiple Messages
  - When: The Turn is selected for the full-fidelity band
  - Then: The Turn is either included or excluded as a whole

**AC-5.2:** Using the workbench, the steward can inspect full-fidelity rendering as raw Messages for the selected Turns.

- **TC-5.2a: Selected full-fidelity turn renders raw messages**
  - Given: One or more Turns are selected for the full-fidelity band
  - When: The draft Thread View is materialized
  - Then: The full-fidelity band emits the raw Messages from those Turns in source order
- **TC-5.2b: Full-fidelity band preserves raw actor back-and-forth**
  - Given: A selected Turn contains multiple actor exchanges
  - When: The full-fidelity band is materialized
  - Then: The emitted full-fidelity content preserves the original message sequence

**AC-5.3:** Using the workbench, the steward can compose the smooth band from turn selections distinct from the full-fidelity band.

- **TC-5.3a: Smooth band uses selected turns**
  - Given: A draft Thread View contains a smooth band
  - When: The steward fills that band
  - Then: The selected source units are Turns
- **TC-5.3b: Smooth band follows the full-fidelity boundary by default**
  - Given: A draft Thread View has selected full-fidelity Turns and no bespoke curation override applies
  - When: The steward fills the smooth band
  - Then: Smooth-band selection starts from the next older eligible turns outside the full-fidelity region

**AC-5.4:** Using the workbench, the steward can inspect smooth-band rendering as smooth-turn representations for selected Turns.

- **TC-5.4a: Selected smooth turn renders one smooth representation**
  - Given: A Turn has a smooth representation available
  - When: The Turn is selected for the smooth band
  - Then: The smooth band emits the smooth-turn representation for that Turn
- **TC-5.4b: Missing smooth artifact is visible**
  - Given: A Turn is selected for the smooth band and no smooth representation is available
  - When: The draft Thread View is inspected
  - Then: The workbench reports that the selected Turn lacks a smooth representation

**AC-5.5:** Using the workbench, the steward can exclude Turns from a Thread View as a curation decision.

- **TC-5.5a: Turn can be excluded from draft Thread View**
  - Given: A Turn would otherwise be part of a draft Thread View
  - When: The steward excludes that Turn
  - Then: The Turn is removed from the draft Thread View composition
- **TC-5.5b: Exclusion does not mutate source Thread**
  - Given: A Turn is excluded from a Thread View
  - When: The source Thread is read
  - Then: The Turn and its Messages remain unchanged in source truth

### 6. Lower-Band Awareness

The workbench understands lower-band composition without making chunk workflows central to Feature 2. Detailed and brief bands use chunk selections. Open chunk content remains in the smooth region until the chunk is closed.

1. Steward opens a draft or active Thread View.
2. Workbench shows detailed and brief band regions.
3. Workbench shows which closed chunks are currently eligible for those bands.
4. Workbench keeps open chunk content out of the lower bands.
5. Steward can inspect lower-band readiness without entering the full chunk-maintenance workflow.

#### Acceptance Criteria

**AC-6.1:** Using the workbench, the steward can see that detailed and brief bands are chunk-based.

- **TC-6.1a: Detailed band uses chunk selections**
  - Given: A Thread View contains a detailed band
  - When: The workbench reads the band's composition
  - Then: The selected source units are chunks
- **TC-6.1b: Brief band uses chunk selections**
  - Given: A Thread View contains a brief band
  - When: The workbench reads the band's composition
  - Then: The selected source units are chunks

**AC-6.2:** Using the workbench, the steward can rely on open chunk content remaining outside lower-band representations.

- **TC-6.2a: Open chunk does not enter detailed band**
  - Given: A chunk is open
  - When: The steward inspects lower-band eligibility
  - Then: That chunk is not eligible for detailed-band representation
- **TC-6.2b: Open chunk does not enter brief band**
  - Given: A chunk is open
  - When: The steward inspects lower-band eligibility
  - Then: That chunk is not eligible for brief-band representation

**AC-6.3:** Using the workbench, the steward can inspect lower-band readiness.

- **TC-6.3a: Closed chunk with detailed artifact is shown as eligible for detailed band**
  - Given: A closed chunk has its detailed summary available
  - When: The workbench inspects lower-band readiness
  - Then: The chunk is shown as eligible for detailed-band use
- **TC-6.3b: Closed chunk missing required artifact is shown as not ready**
  - Given: A closed chunk lacks a required lower-band artifact
  - When: The workbench inspects lower-band readiness
  - Then: The chunk is shown as not ready for the relevant lower band

**AC-6.4:** Using the workbench, the steward can inspect chunk state in a minimal, reader-oriented way.

- **TC-6.4a: Chunk detail can be opened without exposing full chunk-control workflow**
  - Given: A chunk exists
  - When: The steward opens chunk detail
  - Then: The workbench shows chunk identity, lifecycle state, and available representations without exposing the full maintenance control plane
- **TC-6.4b: Missing chunk data does not block upper-band inspection**
  - Given: Chunk artifacts are incomplete
  - When: The steward inspects full-fidelity or smooth-band composition
  - Then: Upper-band inspection remains available and chunk incompleteness is localized to lower-band readiness

### 7. View Comparison And Activation

The steward needs to compare a draft Thread View against the active one, understand what will change, and activate the new view when ready.

1. Steward opens a draft Thread View and the current active Thread View.
2. Workbench compares their band structure and composition.
3. Steward confirms activation of the draft.
4. Workbench activates the draft and archives the previously active view.

#### Acceptance Criteria

**AC-7.1:** Using the workbench, the steward can compare draft and active Thread Views.

- **TC-7.1a: Comparison shows band-level differences**
  - Given: A draft Thread View and an active Thread View both exist
  - When: The steward compares them
  - Then: The workbench shows differences in band composition
- **TC-7.1b: Comparison shows selection differences**
  - Given: A draft differs from the active view in selected turns or chunks
  - When: The steward compares them
  - Then: The workbench shows which source units differ between the views

**AC-7.2:** Using the workbench, the steward can inspect the materialized emitted result of a draft before activation.

- **TC-7.2a: Draft emitted message sequence is inspectable**
  - Given: A draft Thread View has been assembled
  - When: The steward opens the draft's materialized result
  - Then: The steward can inspect the emitted message sequence before activation
- **TC-7.2b: Missing materialized output is explicit**
  - Given: A draft Thread View has selections but no materialized output yet
  - When: The steward opens the draft result
  - Then: The workbench explicitly reports that the emitted result is not yet materialized

**AC-7.3:** Using the workbench, the steward can activate a draft Thread View while preserving one-active-view invariants.

- **TC-7.3a: Activating draft makes it the only active view**
  - Given: A Thread has one active view and one draft view
  - When: The steward activates the draft
  - Then: The draft becomes active and no second active view exists
- **TC-7.3b: Prior active view is preserved as archived**
  - Given: A Thread has an active view and a draft view
  - When: The steward activates the draft
  - Then: The prior active view is archived rather than deleted

**AC-7.4:** Using the workbench, the steward can activate or archive a Thread View without mutating source truth.

- **TC-7.4a: Source thread remains unchanged after activation**
  - Given: A draft Thread View is activated
  - When: The source Thread is read
  - Then: The source Thread records remain unchanged
- **TC-7.4b: Archived view remains readable**
  - Given: A previously active Thread View has been archived
  - When: The steward opens the archived view
  - Then: The archived view remains readable as a historical curated context

---

## Data Contracts

Data contracts define the workbench-facing records and boundary operations for Feature 2. These contracts stay functional and stack-neutral. Exact storage schemas and internal TypeScript interfaces belong in Tech Design.

### Boundary Operations

| Operation | Initiator | Input | Success Output | Error Output |
|-----------|-----------|-------|----------------|--------------|
| Open thread in workbench | Steward, operator, deterministic code | Thread identifier | Source-thread status, active-view status, visible Thread Views | Missing thread, unreadable thread state |
| Open fixture thread in workbench | Steward, operator, deterministic code | Fixture identifier | Fixture thread rendered through the normal Thread inspection flow | Missing fixture, unreadable fixture state |
| Search workbench records | Steward, operator, deterministic code | Query + record scope + optional metadata filters | Ordered result list in summary form | Search failure with record scope and reason |
| Open workbench detail | Steward, operator, deterministic code | Record identifier | Full-detail representation + related pivots | Missing record or unreadable detail |
| Create draft Thread View | Steward or operator | Thread identifier + optional label/purpose | Empty draft Thread View | Thread unreadable, active-view invariant failure |
| Update draft band composition | Steward or operator | Draft Thread View + selected turns/chunks + exclusions | Updated band composition + materialized draft result when available | Invalid selection, missing required source artifact |
| Compare Thread Views | Steward or operator | Draft Thread View + active Thread View | Difference summary + inspectable materialized outputs | One or both views unreadable |
| Activate draft Thread View | Steward or operator | Draft Thread View identifier | Draft becomes active; prior active archived | Invalid activation state, missing draft, one-active invariant failure |
| Archive draft Thread View | Steward or operator | Draft Thread View identifier | Draft becomes archived and remains readable | Invalid state transition, missing draft |

### Thread View

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| threadViewId | string | yes | non-empty; unique within Thread | Thread View identifier |
| threadId | string | yes | existing Thread | Source Thread for this view |
| state | string | yes | `active`, `draft`, `archived` | Current lifecycle state |
| name | string | no | non-empty | Human-readable label |
| purpose | string | no | non-empty | Intended use of the view |
| createdAt | timestamp | yes | ISO 8601 UTC | Creation time |
| updatedAt | timestamp | yes | ISO 8601 UTC | Last edit time |
| sourceStateReference | string | no | non-empty | Source Thread state marker used to assemble the view |
| fullFidelityBand | BandRecord | yes | ordered band record | Full-fidelity band composition |
| smoothBand | BandRecord | yes | ordered band record | Smooth band composition |
| detailedBand | BandRecord | yes | ordered band record | Detailed band composition |
| briefBand | BandRecord | yes | ordered band record | Brief band composition |
| emittedMessages | array of ThreadViewMessage | no | ordered when present | Materialized message sequence emitted by this view |
| status | string | yes | `ready`, `incomplete`, `blocked`, `unknown` | Workbench-facing readiness for use or activation |

### BandRecord

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| bandType | string | yes | `full_fidelity`, `smooth`, `detailed`, `brief` | Band identity |
| targetTokenBudget | integer | no | >= 0 | Intended budget for the band |
| sourceUnitType | string | yes | `turn`, `chunk` | Source-unit class for this band |
| selectedIds | array of string | yes | ordered; may be empty | Selected source units in band order |
| exclusions | array of string | no | ordered; source-unit ids | Source units intentionally excluded from this band or view |
| renderedStatus | string | yes | `ready`, `missing_artifacts`, `blocked`, `unknown` | Whether the band can currently materialize its intended representation |

### ThreadViewMessage

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| threadViewMessageId | string | yes | non-empty; unique within Thread View | Emitted message identifier |
| threadViewId | string | yes | existing Thread View | Owning Thread View |
| bandType | string | yes | existing band type | Band that emitted the message |
| sourceKind | string | yes | `raw_turn_message`, `smooth_turn`, `detailed_chunk_summary`, `brief_chunk_summary` | Representation source |
| sourceReference | string | yes | non-empty | Source turn, message, or chunk reference |
| messageOrder | integer | yes | increasing within Thread View | Position in the emitted message sequence |
| content | string or structured message payload | yes | non-empty; target-bindable | Emitted message content compatible with runtime binding, including PI-compatible payloads when PI is the target |

### Search Result Summary

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| resultType | string | yes | `message`, `turn`, `thread_view`, `chunk` | Record class returned |
| resultId | string | yes | non-empty | Identifier of the matching record |
| title | string | yes | non-empty | Compact label for the result |
| summaryText | string | yes | may be truncated | High-signal skim text |
| status | string | no | record-specific | Compact current-state hint |
| relationshipHints | array of string | no | non-empty strings | Hints for related turn, band, or view placement |

### Error Codes

| Code | Description |
|------|-------------|
| THREAD_NOT_FOUND | Requested Thread does not exist |
| THREAD_VIEW_NOT_FOUND | Requested Thread View does not exist |
| THREAD_VIEW_INVALID_STATE | Requested operation is not valid for the Thread View state |
| ACTIVE_THREAD_VIEW_CONFLICT | Activation would violate the one-active-view invariant |
| WORKBENCH_SEARCH_FAILED | Search could not be completed |
| WORKBENCH_DETAIL_UNREADABLE | Requested detail could not be rendered |
| BAND_SELECTION_INVALID | Selected source units are not valid for the band |
| BAND_RENDER_BLOCKED | Selected band cannot be rendered because required source artifacts are missing |
| TURN_EXCLUSION_INVALID | Requested exclusion is not valid for the current draft view |

---

## Dependencies

### Technical Dependencies

- Feature 1 Thread, Message, Turn, Import, Projection, and Fixture records.
- Feature 1 turn-health and readiness signals.
- Thread View persistence support introduced for Feature 2.
- Existing smooth-turn and chunk metadata where available from downstream work or fixtures.
- Search and read operations over canonical Thread records.

### Process Dependencies

- Product agreement that Thread View editing is curation, not source mutation.
- Product agreement that Feature 2 includes Thread View editing but not full smart compact execution.
- Tech Design confirmation of how Thread View persistence coexists with later projection compiler work.

---

## Non-Functional Requirements

### Interaction Speed

- Search and skim operations should support large result sets without requiring full-detail rendering for each item.
- Opening one item in full detail should not require reading unrelated full-detail payloads.

### Source Safety

- No Thread View editing operation mutates source Thread records.
- Activation and archival of Thread Views preserve source records unchanged.

### Readability

- Summary forms for search and skim views must preserve the information needed to decide what to open next.
- Full detail remains available when summary forms are insufficient.

### Consistency

- Thread View state must preserve the one-active-view invariant.
- Band composition must preserve the band order `full_fidelity -> smooth -> detailed -> brief`.

---

## Tech Design Questions

Questions for the Tech Lead to address during design:

1. What persisted record shape should Thread Views use, and where should those records live relative to the Thread store?
2. How should the workbench materialize and store emitted Thread View messages without duplicating or corrupting source truth?
3. What search indexes or read helpers are needed to support fast content and metadata search across messages, turns, and Thread Views against file-backed storage?
4. How should the workbench identify a source-state reference for a draft Thread View?
5. How should lower-band readiness be represented when chunk or summary artifacts are partially present?
6. Which comparison outputs are required for draft-vs-active review beyond band membership and emitted message sequence?
7. How does Thread View activation interact with later Feature 3 smart compact runtime reload behavior?
8. What minimal chunk fields should be surfaced in Feature 2 without exposing the full chunk-maintenance workflow?
9. What truncation policy should skim-oriented summary rows use so large result sets remain recognizable and useful?
10. How should fixtures expose Thread Views, or should fixtures initially expose only source-thread state until Thread View fixture support is added?

---

## Recommended Story Breakdown

### Story 0: Foundation (Infrastructure)

**Delivers:** Thread View record vocabulary, error codes, search-result summary builders, Thread View test fixtures, and project scripts/config needed for workbench testing.

**Prerequisite:** Epic accepted.

**Estimated test count:** 8-12 foundation tests

### Story 1: Thread And Thread View Inspection

**Delivers:** The workbench can open a Thread, show source-vs-active-view state, list Thread Views, and report usable vs blocked thread status.

**Prerequisite:** Story 0

**ACs covered:**
- AC-1.1
- AC-1.2
- AC-1.3
- AC-1.4
- AC-1.5

**Estimated test count:** 10-14 tests

### Story 2: Search, Skim, And Full Detail

**Delivers:** The workbench can search messages, turns, and Thread Views, render skim-friendly result lists, open full detail, and pivot between related records.

**Prerequisite:** Story 1

**ACs covered:**
- AC-2.1
- AC-2.2
- AC-2.3
- AC-2.4
- AC-3.1
- AC-3.2
- AC-3.3
- AC-3.4

**Estimated test count:** 16-22 tests

### Story 3: Draft Thread View Lifecycle

**Delivers:** The workbench can create empty draft Thread Views from source truth, preserve active/draft/archived states, and enforce one-active-view invariants.

**Prerequisite:** Story 1

**ACs covered:**
- AC-4.1
- AC-4.2
- AC-4.3
- AC-4.4
- AC-4.5

**Estimated test count:** 10-14 tests

### Story 4: Upper-Band Composition

**Delivers:** The workbench can fill full-fidelity and smooth bands from turn selections, render the selected representations, and exclude turns from the draft view.

**Prerequisite:** Story 3

**ACs covered:**
- AC-5.1
- AC-5.2
- AC-5.3
- AC-5.4
- AC-5.5

**Estimated test count:** 16-22 tests

### Story 5: Lower-Band Awareness

**Delivers:** The workbench can show lower-band chunk selections, keep open chunk content out of lower bands, and expose minimal lower-band readiness without full chunk control-plane behavior.

**Prerequisite:** Story 4

**ACs covered:**
- AC-6.1
- AC-6.2
- AC-6.3
- AC-6.4

**Estimated test count:** 10-14 tests

### Story 6: View Comparison And Activation

**Delivers:** The workbench can compare draft and active Thread Views, inspect the materialized draft result, activate a draft, and archive the prior active view.

**Prerequisite:** Stories 3 and 4

**ACs covered:**
- AC-7.1
- AC-7.2
- AC-7.3
- AC-7.4

**Estimated test count:** 12-16 tests

### Sequencing Rationale

Inspection comes before editing because the workbench has to make source and active-view state legible before it can safely support Thread View curation.

Search and detail follow immediately because fast location and inspection of source material are prerequisites for any practical view-building workflow.

Draft lifecycle comes before band composition because the workbench needs a durable editable object before it can fill bands.

Upper-band composition precedes lower-band awareness because turns are the first practical curation units in this feature, while deeper chunk curation remains Feature 3 scope and chunk-backed lower bands remain only minimally operational here.

Comparison and activation come last because they depend on draft creation and composition being in place first.

---

## Validation Checklist

- [x] User Profile has all four fields + Feature Overview
- [x] Flows cover core read, skim, inspect, draft, compose, compare, and activate paths
- [x] Every AC is testable
- [x] Every AC has at least one TC
- [x] TCs cover happy path, edge cases, and source-safety constraints
- [x] Data contracts are specified at system boundaries and workbench-facing boundaries
- [x] Scope boundaries are explicit
- [x] Story breakdown covers all ACs
- [x] Stories sequence logically
- [ ] Validation review complete
- [x] Self-review complete
