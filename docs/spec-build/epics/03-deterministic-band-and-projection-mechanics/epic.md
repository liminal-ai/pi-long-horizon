# Epic 3: Deterministic Band And Projection Mechanics

This epic defines the complete requirements for deterministic band and projection mechanics. It serves as the Feature 3 epic requirements.

---

## Onboarding Context

PI Long Horizon stores a complete source Thread and uses Thread Views as curated runtime-facing context assemblies over that source history. A Thread View contains four ordered band regions: full fidelity, smooth, detailed, and brief. Feature 2 made Thread Views searchable, inspectable, editable, and activatable. Feature 3 makes the banded maintenance loop operational.

Feature 3 does not introduce model-adjudicated smoothing, boundary decisions, or semantic summaries. It establishes the deterministic mechanics of smoothing, chunk formation, placeholder lower-band compression, Thread View rebuild, generated PI session output, and PI reload. It also turns Epic 2's shallow lower-band awareness seam into a production-backed chunk and lower-band path. Feature 4 later replaces the placeholder quality of those lower-fidelity representations with model-calibrated behavior.

---

## User Profile

**Primary User:** Context Steward

**Context:** The steward manages a PI coding session whose source Thread continues to grow while the active Thread View approaches the runtime context ceiling. The steward needs deterministic, inspectable maintenance mechanics that can smooth turns, form chunks, rebuild Thread Views across all bands, and generate a shorter PI-compatible session file without requiring model work.

**Mental Model:** "Recent turns stay raw. Older turns are smoothed, grouped into chunks, and moved into lower-fidelity bands. When the session needs to shrink, I run smart compact with an explicit lower-bound target and band mix, rebuild a new active view under that target, and reload PI with the new generated session file."

**Key Constraint:** Feature 3 must prove the full interlocking context-maintenance loop without depending on model quality, model latency, or model availability.

**Secondary Users:** The human operator triggers manual smart compact, inspects blocked or degraded maintenance state, and validates that PI reloads a mechanically correct generated session file. Feature 4 later uses the same mechanics as the substrate for model-tuned smoothing, chunk boundaries, and summaries.

---

## Feature Overview

This feature gives PI Long Horizon its first complete deterministic maintenance loop. It turns closed Turns into deterministic smooth-turn representations, grows and closes one open Chunk at a time, generates deterministic placeholder detailed and brief chunk representations, rebuilds Thread Views across all four bands under explicit operator-supplied compaction inputs, writes a generated PI session file atomically, and reloads PI from that output.

Feature 3 proves the mechanics of banded fidelity management before Feature 4 improves quality with model work.

Flow summary:

- [Smooth Turn Preparation](#1-smooth-turn-preparation): closed Turns receive deterministic smooth representations, and stale or missing smooth output is visible and repairable. AC: `1.1-1.4`
- [Deterministic Chunk Formation](#2-deterministic-chunk-formation): one open Chunk grows from smooth Turns, closes by deterministic threshold rules, and opens the next Chunk without model adjudication. AC: `2.1-2.5`
- [Placeholder Lower-Fidelity Representations](#3-placeholder-lower-fidelity-representations): closed Chunks receive deterministic 30% and 5% placeholder representations with explicit markers and token accounting. AC: `3.1-3.4`
- [Band Rebuild And View Materialization](#4-band-rebuild-and-view-materialization): the steward rebuilds a draft Thread View across all four bands from explicit per-run compaction inputs using deterministic band allocation rules. AC: `4.1-4.6`
- [Manual Smart Compact And PI Reload](#5-manual-smart-compact-and-pi-reload): the operator runs smart compact, the system checks prerequisites, writes the generated PI session file atomically, archives the prior generated output, and reloads PI. AC: `5.1-5.6`
- [Blocked And Degraded Deterministic Maintenance State](#6-blocked-and-degraded-deterministic-maintenance-state): missing prerequisites, invalid derived state, and threshold failures are reported explicitly rather than hidden. AC: `6.1-6.5`

---

## Scope

### In Scope

- Deterministic smooth-turn generation for closed Turns.
- Deterministic normalization of whitespace and other safe text cleanup during smoothing.
- Deterministic handling of tool output truncation or removal according to fixed policy.
- One open Chunk per Thread.
- Deterministic open-Chunk growth and closure rules.
- Closed-Chunk placeholder detailed representation at approximately 30% of smooth-chunk length, with explicit placeholder marker.
- Closed-Chunk placeholder brief representation at approximately 5% of smooth-chunk length, with explicit placeholder marker.
- Token accounting for raw Turns, smooth Turns, smooth Chunks, placeholder detailed chunk representations, and placeholder brief chunk representations.
- Manual smart compact inputs for lower-bound target and per-band allocation percentages.
- Deterministic draft Thread View rebuild under explicit per-run compaction inputs.
- Deterministic band allocation across full fidelity, smooth, detailed, and brief bands.
- Manual smart compact command.
- Generated PI session file write, archive, and PI reload.
- Production-backed chunk reads and lower-band validation at the workbench and materialization boundary.
- Explicit blocked or degraded maintenance reporting for deterministic mechanics.
- Fixture-backed validation of threshold behavior, chunk closure, band allocation, and generated output mechanics.

### Out of Scope

- Model-assisted smooth-turn generation. Feature 4.
- Model-assisted chunk boundary adjudication. Feature 4.
- Model-generated detailed summaries. Feature 4.
- Model-generated brief summaries. Feature 4.
- Automatic smart compact trigger. Future direction.
- Persisted default smart compact policies or threshold schedules. Future direction after deterministic dogfooding.
- Full async dependency-graph inspection. Future work after Feature 3.
- Higher-order chunk merging. Future direction.
- Non-PI projection targets. Future direction.
- Web UI for compaction control. Future direction.

### Assumptions

| ID | Assumption | Status | Owner | Notes |
|----|------------|--------|-------|-------|
| A1 | Deterministic placeholder lower-band representations are sufficient to validate band mechanics before Feature 4 improves quality. | Validated from product direction | Product | Placeholder quality is intentional and explicit. |
| A2 | Deterministic chunk boundary rules can be explained and tested clearly enough to replace model adjudication in Feature 3. | Validated from product direction | Product | Feature 4 later improves boundary quality without changing the broad chunk lifecycle. |
| A3 | Closed Turns are the correct unit for deterministic smoothing and upper-band allocation. | Validated from Epic 2 direction | Product + Tech Lead | Message-level splitting remains out of scope. |
| A4 | Closed Chunks are the correct unit for detailed and brief lower-band allocation even when their contents are placeholder compressions. | Validated from product direction | Product + Tech Lead | Open Chunk content remains in the smooth band. |
| A5 | Manual smart compact remains the only compaction trigger in Feature 3, and the operator supplies compaction inputs per run instead of relying on stored default policy. | Validated from product direction | Product | Persisted defaults are deferred until the deterministic mechanics have been dogfooded. |
| A6 | The active Thread View is the compaction input and the generated PI session file remains disposable projection output rather than source truth. | Validated from architecture | Product + Tech Lead | Feature 3 deepens this relationship without collapsing the concepts. |

---

## Flows & Requirements

### 1. Smooth Turn Preparation

Closed Turns need deterministic smooth representations before they can enter chunk mechanics or lower-fidelity band planning. Feature 3 does not ask a model to summarize a Turn. It creates one smooth-turn text field per closed Turn by concatenating Turn content into a single readable representation, preserving actor sections, applying deterministic text normalization, and applying deterministic tool-output handling.

1. A Turn closes.
2. The steward checks whether the Turn already has current smooth output.
3. If not, the steward generates deterministic smooth text for the Turn.
4. The steward records the smooth text, smooth token count, and smooth readiness state.
5. If smooth output is missing or stale when later work needs it, the steward reports or repairs it through the same deterministic path.

#### Acceptance Criteria

**AC-1.1:** The steward generates one deterministic smooth representation for each closed Turn.

- **TC-1.1a: Closed Turn receives smooth text**
  - Given: A Turn is closed and has no current smooth output
  - When: deterministic smoothing runs
  - Then: the Turn receives one smooth text representation and a smooth token count
- **TC-1.1b: Open Turn does not receive final smooth text**
  - Given: A Turn is still open
  - When: deterministic smoothing is evaluated
  - Then: the Turn is not marked as having final smooth output

**AC-1.2:** Deterministic smooth output preserves enough structure to remain readable and useful for later chunking.

- **TC-1.2a: Smooth text preserves actor sections**
  - Given: A closed Turn contains content from multiple actor types
  - When: deterministic smoothing runs
  - Then: the smooth text preserves the actor back-and-forth in a standardized readable form using fixed section markers for user, assistant, tool, and thinking content
- **TC-1.2b: Smooth text remains one single text field per Turn**
  - Given: A closed Turn contains multiple source Messages
  - When: deterministic smoothing runs
  - Then: the output is one smooth text field for the Turn rather than multiple separate emitted records

**AC-1.3:** Deterministic smoothing applies only fixed normalization and fixed tool-output rules.

- **TC-1.3a: Whitespace normalization is deterministic**
  - Given: A closed Turn contains irregular whitespace
  - When: deterministic smoothing runs
  - Then: the resulting smooth text applies the same fixed normalization rule each time
- **TC-1.3b: Tool-output handling follows fixed policy**
  - Given: A closed Turn contains tool output large enough to trigger smoothing policy
  - When: deterministic smoothing runs
  - Then: tool output is truncated or removed according to fixed deterministic policy rather than model judgment

**AC-1.4:** Missing, stale, or invalid smooth output is visible and repairable.

- **TC-1.4a: Missing smooth output is explicit**
  - Given: A closed Turn lacks smooth output
  - When: the steward inspects smooth readiness or later work depends on that Turn
  - Then: the missing smooth state is reported explicitly
- **TC-1.4b: Stale or invalid smooth output can be regenerated**
  - Given: A closed Turn has stale or invalid smooth output
  - When: deterministic smooth repair runs
  - Then: the smooth output is regenerated through the same deterministic path

### 2. Deterministic Chunk Formation

Feature 3 introduces one open Chunk per Thread. Closed smooth Turns become chunk-eligible through deterministic readiness and recency rules, join the open Chunk in order, and remain available for the smooth band until lower-band allocation later uses closed Chunks. The open Chunk closes by deterministic smooth-token-count rules rather than by model adjudication. Closed Chunks remain stable by default.

1. A smooth Turn becomes chunk-eligible.
2. The steward appends the Turn to the one open Chunk.
3. The steward checks whether the open Chunk should remain open or close.
4. If closure conditions are met, the steward closes the Chunk and opens the next one.
5. Later Turns append to the new open Chunk.

#### Acceptance Criteria

**AC-2.1:** A closed smooth Turn becomes chunk-eligible through deterministic readiness rules before lower-band allocation uses closed Chunks.

- **TC-2.1a: Open or unsmoothed Turn is not chunk-eligible**
  - Given: A Turn is still open or lacks current smooth output
  - When: chunk eligibility is evaluated
  - Then: the Turn is not chunk-eligible
- **TC-2.1b: Closed smoothed Turn becomes chunk-eligible**
  - Given: A Turn is closed and has current smooth output
  - When: chunk eligibility is evaluated
  - Then: the Turn becomes chunk-eligible

**AC-2.2:** The steward maintains exactly one open Chunk per Thread.

- **TC-2.2a: One open Chunk exists during normal operation**
  - Given: A Thread is under deterministic chunk maintenance
  - When: chunk state is inspected
  - Then: exactly one Chunk is open
- **TC-2.2b: Closed Chunks remain closed**
  - Given: A Chunk has been closed
  - When: later chunk maintenance runs
  - Then: new Turns are not appended to that Chunk

**AC-2.3:** The steward appends chunk-eligible smooth Turns to the open Chunk in source order.

- **TC-2.3a: Eligible Turn joins open Chunk**
  - Given: A smooth Turn is chunk-eligible and an open Chunk exists
  - When: chunk update runs
  - Then: the Turn is appended to the open Chunk
- **TC-2.3b: Chunk order follows Turn order**
  - Given: Multiple smooth Turns become chunk-eligible
  - When: they are appended to the open Chunk
  - Then: their order inside the Chunk follows canonical Turn order

**AC-2.4:** The steward closes the open Chunk by deterministic smooth-token-count threshold rules rather than model judgment.

- **TC-2.4a: Open Chunk stays open below close threshold**
  - Given: The open Chunk remains below its deterministic close conditions
  - When: chunk closure is evaluated
  - Then: the Chunk remains open
- **TC-2.4b: Open Chunk closes when deterministic close condition is met**
  - Given: The open Chunk reaches its deterministic close condition
  - When: chunk closure is evaluated
  - Then: the Chunk closes and a new open Chunk is created
- **TC-2.4c: Hard-cap closure is explicit**
  - Given: The open Chunk reaches a deterministic hard maximum even without a cleaner earlier stop
  - When: chunk closure is evaluated
  - Then: the Chunk closes because the hard-cap rule was met

**AC-2.5:** Chunk closure state is inspectable and stable.

- **TC-2.5a: Closed Chunk reports closed state and token size**
  - Given: A Chunk has closed
  - When: chunk detail is inspected
  - Then: the Chunk reports closed state and its smooth-token size
- **TC-2.5b: Open Chunk reports current partial state**
  - Given: The current Chunk is still open
  - When: chunk detail is inspected
  - Then: the Chunk reports open state and its current smooth-token size

### 3. Placeholder Lower-Fidelity Representations

Feature 3 proves lower-band mechanics without semantic summarization. Each closed Chunk receives deterministic placeholder lower-fidelity representations. The detailed placeholder compresses the Chunk body to approximately 30% of its smooth length and marks itself explicitly as a deterministic placeholder. The brief placeholder compresses the Chunk body to approximately 5% of its smooth length and also marks itself explicitly.

1. A Chunk closes.
2. The steward checks whether placeholder detailed and brief representations exist.
3. The steward generates the 30% placeholder detailed representation.
4. The steward generates the 5% placeholder brief representation.
5. The steward records token counts and placeholder strategy metadata.

#### Acceptance Criteria

**AC-3.1:** A closed Chunk receives a deterministic placeholder detailed representation.

- **TC-3.1a: Closed Chunk gets 30% placeholder representation**
  - Given: A Chunk is closed and has no detailed representation
  - When: placeholder detailed generation runs
  - Then: the Chunk receives a deterministic detailed representation at approximately 30% of the smooth-chunk length
- **TC-3.1b: Detailed placeholder is explicitly marked**
  - Given: A placeholder detailed representation exists
  - When: the representation is inspected
  - Then: it includes an explicit marker that it is a deterministic placeholder compression

**AC-3.2:** A closed Chunk receives a deterministic placeholder brief representation.

- **TC-3.2a: Closed Chunk gets 5% placeholder representation**
  - Given: A Chunk is closed and has no brief representation
  - When: placeholder brief generation runs
  - Then: the Chunk receives a deterministic brief representation at approximately 5% of the smooth-chunk length
- **TC-3.2b: Brief placeholder is explicitly marked**
  - Given: A placeholder brief representation exists
  - When: the representation is inspected
  - Then: it includes an explicit marker that it is a deterministic placeholder compression

**AC-3.3:** Placeholder lower-fidelity representations are deterministic and regenerable.

- **TC-3.3a: Same closed Chunk yields same placeholder output under same source state**
  - Given: A closed Chunk has unchanged smooth content
  - When: deterministic placeholder generation runs again
  - Then: the resulting placeholder representation is the same for that source state
- **TC-3.3b: Placeholder representation can be regenerated after deletion or invalidation**
  - Given: A closed Chunk is missing a placeholder representation
  - When: deterministic placeholder generation runs
  - Then: the representation is recreated through the same deterministic path

**AC-3.4:** Placeholder lower-fidelity generation records token accounting and strategy metadata.

- **TC-3.4a: Detailed placeholder records token count**
  - Given: A detailed placeholder representation is generated
  - When: its metadata is inspected
  - Then: the token count for that representation is available
- **TC-3.4b: Brief placeholder records token count and placeholder strategy**
  - Given: A brief placeholder representation is generated
  - When: its metadata is inspected
  - Then: the token count and placeholder strategy are available

### 4. Band Rebuild And View Materialization

When the operator runs smart compact, the steward rebuilds a new draft Thread View using explicit per-run compaction inputs. Those inputs include a lower-bound target and a band-allocation mix. The rebuild is deterministic. Full fidelity is filled first from newest raw Turns. Smooth is filled next from older smooth Turns. Detailed and brief use closed Chunks and their placeholder lower-fidelity representations. Empty lower bands remain explicit when no closed Chunks are available, and invalid run-input mixes are rejected before allocation starts.

1. The operator provides smart compact inputs for a run.
2. The steward creates or opens a draft Thread View for the rebuild.
3. The steward applies the requested lower-bound target and band-allocation percentages.
4. The steward fills the full-fidelity band from newest Turns backward.
5. The steward fills the smooth band from the next eligible Turns.
6. The steward fills detailed and brief bands from closed Chunks using available placeholder representations.
7. The steward materializes the final emitted message sequence for the draft Thread View.

#### Acceptance Criteria

**AC-4.1:** The steward rebuilds a draft Thread View from explicit per-run compaction inputs.

- **TC-4.1a: Rebuild accepts explicit lower-bound target and band mix**
  - Given: The operator provides a lower-bound target and per-band allocation percentages
  - When: deterministic rebuild starts
  - Then: the rebuild uses those explicit inputs for that run
- **TC-4.1b: Invalid compaction inputs are rejected explicitly**
  - Given: The operator provides invalid compaction inputs
  - When: deterministic rebuild starts
  - Then: the rebuild is rejected explicitly rather than silently coerced

**AC-4.2:** Full-fidelity band is filled first from newest raw Turns without splitting Turn boundaries.

- **TC-4.2a: Full-fidelity selection starts from newest Turns**
  - Given: A draft rebuild begins
  - When: the full-fidelity band is filled
  - Then: selection starts from the newest eligible Turns and works backward
- **TC-4.2b: Turn boundaries remain intact in full fidelity**
  - Given: A Turn would partially fit if split
  - When: full-fidelity band selection runs
  - Then: the Turn is either fully included or fully excluded
- **TC-4.2c: Full-fidelity-only overage is explicit**
  - Given: The selected full-fidelity region alone exceeds the requested lower-bound target
  - When: deterministic rebuild completes or stops
  - Then: the overage is reported explicitly rather than hidden

**AC-4.3:** Smooth band is filled next from older smooth Turns without splitting Turn boundaries.

- **TC-4.3a: Smooth band begins after the full-fidelity region by default**
  - Given: Full-fidelity selection has finished and no bespoke exclusion applies
  - When: the smooth band is filled
  - Then: selection begins from the next older eligible Turns
- **TC-4.3b: Turn boundaries remain intact in the smooth band**
  - Given: A smooth Turn would partially fit if split
  - When: smooth-band selection runs
  - Then: the Turn is either fully included or fully excluded

**AC-4.4:** Detailed and brief bands use closed Chunks only.

- **TC-4.4a: Closed Chunk can enter detailed or brief band**
  - Given: A Chunk is closed and has the required placeholder representation
  - When: lower-band allocation runs
  - Then: the Chunk can be selected into the corresponding band
- **TC-4.4b: Open Chunk cannot enter detailed or brief band**
  - Given: A Chunk is still open
  - When: lower-band allocation runs
  - Then: the Chunk is not eligible for detailed or brief band selection
- **TC-4.4c: No closed Chunks leaves lower bands empty explicitly**
  - Given: No closed Chunks are available for lower-band allocation
  - When: lower-band allocation runs
  - Then: the detailed and brief bands remain explicitly empty

**AC-4.5:** The rebuilt draft Thread View materializes a full emitted message sequence across all selected bands.

- **TC-4.5a: Materialized emitted sequence preserves band order**
  - Given: A draft Thread View has selections across multiple bands
  - When: emitted messages are materialized
  - Then: the final message sequence preserves the ordered band layout
- **TC-4.5b: Empty band does not corrupt materialization**
  - Given: One or more bands are empty
  - When: emitted messages are materialized
  - Then: the emitted sequence still materializes correctly from the non-empty bands

**AC-4.6:** The rebuilt draft Thread View targets the requested lower-bound input for that run.

- **TC-4.6a: Successful rebuild lands at or below lower threshold**
  - Given: Required source and placeholder artifacts are available and the operator has provided a lower-bound target
  - When: deterministic rebuild completes
  - Then: the resulting draft Thread View is at or below the requested lower-bound target
- **TC-4.6b: Failure to reach lower threshold is explicit**
  - Given: deterministic rebuild cannot reach the requested lower-bound target with the available mechanics
  - When: the rebuild completes or stops
  - Then: the failure is reported explicitly rather than hidden
- **TC-4.6c: Invalid band-allocation percentages are rejected explicitly**
  - Given: The operator provides an invalid band-allocation mix
  - When: deterministic rebuild starts
  - Then: the run is rejected explicitly before allocation proceeds

### 5. Manual Smart Compact And PI Reload

The operator runs smart compact when the active Thread View needs to shrink or when the operator wants to test a specific compaction shape. Feature 3 uses the deterministic rebuild mechanics to produce the generated PI session file, write it atomically, archive the prior generated output, and reload PI through the existing PI session-switch path. The command is driven by explicit per-run inputs rather than by stored default policy.

1. Operator runs the manual smart compact command with explicit per-run inputs.
2. The steward checks prerequisites and active Thread View state.
3. The steward rebuilds or validates the target draft Thread View.
4. The steward writes the generated PI session file atomically.
5. The steward archives the prior generated output.
6. The steward reloads PI from the new generated session file.

#### Acceptance Criteria

**AC-5.1:** Manual smart compact accepts explicit run inputs and checks deterministic prerequisites before writing a generated PI session file.

- **TC-5.1a: Smart compact accepts explicit per-run compaction inputs**
  - Given: The operator starts manual smart compact
  - When: the command begins
  - Then: the command accepts explicit lower-bound and band-allocation inputs for that run
- **TC-5.1b: Smart compact rejects invalid per-run compaction inputs**
  - Given: The operator provides invalid compaction inputs
  - When: manual smart compact begins
  - Then: the command rejects the run explicitly
- **TC-5.1c: Smart compact verifies required smooth output**
  - Given: Smart compact starts
  - When: prerequisites are checked
  - Then: the command verifies that required smooth Turn output exists
- **TC-5.1d: Smart compact verifies required placeholder lower-band output**
  - Given: Smart compact starts
  - When: prerequisites are checked
  - Then: the command verifies that required placeholder detailed and brief outputs exist for selected lower-band Chunks
- **TC-5.1e: First smart compact can bootstrap missing deterministic artifacts**
  - Given: A Thread has never previously been compacted and required deterministic derived artifacts do not yet exist
  - When: manual smart compact starts
  - Then: the command can bootstrap the required deterministic smoothing, chunk, and placeholder work or stop explicitly naming the missing prerequisite

**AC-5.2:** Manual smart compact writes the generated PI session file atomically.

- **TC-5.2a: Generated PI session file is written atomically**
  - Given: Smart compact has a valid draft Thread View to project
  - When: the generated PI session file is written
  - Then: the file write is atomic
- **TC-5.2b: Failed write does not leave partial generated output as the current target**
  - Given: generated file writing fails mid-operation
  - When: smart compact handles the failure
  - Then: the current generated target is not left pointing at a partial write

**AC-5.3:** Manual smart compact archives the prior generated output when a new one is written.

- **TC-5.3a: Prior generated output is archived on successful replacement**
  - Given: A current generated PI session file exists
  - When: smart compact writes a new generated PI session file successfully
  - Then: the prior generated output is archived
- **TC-5.3b: First generated output does not require prior archive**
  - Given: No prior generated PI session file exists
  - When: smart compact writes the first generated output
  - Then: the write succeeds without requiring an archive step

**AC-5.4:** Manual smart compact reloads PI from the new generated PI session file.

- **TC-5.4a: PI reload is triggered after successful generated write**
  - Given: Smart compact writes a new generated PI session file successfully
  - When: the compact operation completes
  - Then: PI reload is triggered against the new generated file
- **TC-5.4b: Reload failure is explicit**
  - Given: Generated output writing succeeded but PI reload fails
  - When: smart compact completes
  - Then: the reload failure is reported explicitly

**AC-5.5:** Manual smart compact preserves the distinction between source truth and generated output.

- **TC-5.5a: Smart compact does not mutate canonical source Messages or Turns**
  - Given: Smart compact runs successfully
  - When: source Thread state is inspected afterward
  - Then: canonical Messages and Turns remain source truth and are not rewritten as generated output
- **TC-5.5b: Generated output remains identifiable as projection output**
  - Given: Smart compact has written a generated PI session file
  - When: projection metadata is inspected
  - Then: the generated file is identifiable as projection output rather than canonical source state

**AC-5.6:** Manual smart compact can succeed using deterministic placeholder lower-fidelity content.

- **TC-5.6a: Smart compact succeeds without model-generated summaries**
  - Given: deterministic smooth output and deterministic placeholder lower-band outputs are available
  - When: manual smart compact runs
  - Then: the operation can complete successfully without requiring model-generated summaries
- **TC-5.6b: Placeholder lower-band outputs remain explicit after compaction**
  - Given: a generated PI session file contains lower-band content from placeholder representations
  - When: that output is inspected through projection metadata or fixtures
  - Then: the placeholder nature of those lower-band representations remains explicit

### 6. Blocked And Degraded Deterministic Maintenance State

Feature 3 needs to make deterministic maintenance failures obvious. If smoothing is missing, chunk state is invalid, lower-band placeholders are missing, or the rebuild cannot reach the lower threshold, the system reports blocked or degraded maintenance state rather than silently improvising.

1. A deterministic maintenance step is attempted.
2. The steward detects missing or invalid prerequisite state.
3. The steward records blocked or degraded state.
4. The operator or future workbench can inspect that state and decide what to do next.

#### Acceptance Criteria

**AC-6.1:** Missing deterministic prerequisites block the dependent maintenance step explicitly.

- **TC-6.1a: Missing smooth output blocks dependent chunk or rebuild work**
  - Given: A later deterministic maintenance step depends on smooth output that is missing
  - When: that step runs
  - Then: the step is blocked explicitly
- **TC-6.1b: Missing placeholder lower-band output blocks lower-band use**
  - Given: lower-band allocation or compaction depends on placeholder output that is missing
  - When: the dependent step runs
  - Then: the step is blocked explicitly

**AC-6.2:** Invalid deterministic state is reported rather than silently repaired inside unrelated steps.

- **TC-6.2a: Invalid Chunk state is reported explicitly**
  - Given: Chunk state violates deterministic lifecycle expectations
  - When: the steward inspects or uses that Chunk
  - Then: the invalid state is reported explicitly
- **TC-6.2b: Invalid Thread View materialization state is reported explicitly**
  - Given: A Thread View cannot be materialized consistently from its selections
  - When: the steward attempts materialization or compaction
  - Then: the invalid state is reported explicitly

**AC-6.3:** Failure to hit the lower threshold is reported as degraded deterministic output rather than hidden success.

- **TC-6.3a: Above-target draft reports degraded threshold result**
  - Given: A rebuild completes but remains above the lower threshold
  - When: the result is inspected
  - Then: it reports degraded threshold state explicitly
- **TC-6.3b: Compaction can stop on threshold failure**
  - Given: manual smart compact cannot produce an acceptable draft under threshold policy
  - When: the operation completes or stops
  - Then: the threshold failure is explicit and not treated as silent success

**AC-6.4:** Deterministic maintenance state is inspectable through normal workbench concepts.

- **TC-6.4a: Blocked smooth or chunk state appears in inspectable records**
  - Given: deterministic maintenance has blocked state
  - When: the steward inspects the relevant Turn, Chunk, or Thread View
  - Then: the blocked state is visible through normal workbench inspection
- **TC-6.4b: Projection failure state appears in inspectable output metadata**
  - Given: compaction output or reload failed
  - When: projection metadata is inspected
  - Then: the failure state is visible through normal inspection surfaces

**AC-6.5:** Deterministic placeholder behavior remains explicit rather than being mistaken for final semantic quality.

- **TC-6.5a: Placeholder strategy is visible in lower-band records**
  - Given: a lower-band placeholder representation exists
  - When: the record is inspected
  - Then: the placeholder strategy is visible
- **TC-6.5b: Feature 3 output does not claim semantic summarization quality**
  - Given: Feature 3 deterministic lower-band output is used in a Thread View or projection
  - When: the output is inspected
  - Then: the system does not present it as model-calibrated semantic summary output

---

## Data Contracts

Feature 3 adds no off-machine API contract, but it does add important local system-boundary contracts between deterministic maintenance, Thread View rebuild, and generated PI session output.

### Deterministic Smooth Turn State

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| turnId | string | yes | existing closed Turn id | Turn receiving smooth output |
| smoothText | string | yes | non-empty when ready | Deterministic smooth-turn text |
| smoothTokenCount | integer | yes | `>= 0` | Token count for the smooth representation |
| smoothStatus | enum | yes | `missing`, `ready`, `stale`, `invalid` | Current deterministic smooth state |
| smoothStrategy | string | yes | known strategy slug | Deterministic smoothing strategy used |

### Chunk Lifecycle State

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| chunkId | string | yes | unique | Chunk identifier |
| lifecycleStatus | enum | yes | `open`, `closed`, `inactive` | Current chunk lifecycle state |
| sourceTurnIds | array of string | yes | ordered Turn ids | Turns contributing to the chunk |
| smoothText | string | yes | may be partial only for open Chunk | Concatenated smooth-turn body |
| smoothTokenCount | integer | yes | `>= 0` | Token count of the smooth chunk body |
| closeReason | enum | no | deterministic reason code | Why the chunk closed |

### Placeholder Lower-Fidelity State

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| chunkId | string | yes | existing closed Chunk id | Chunk receiving lower-fidelity placeholder output |
| detailedText | string | no | explicit placeholder marker when present | Deterministic placeholder detailed representation |
| detailedTokenCount | integer | no | `>= 0` when present | Token count for detailed placeholder |
| detailedStrategy | string | no | `deterministic_truncate_30` when present | Placeholder generation strategy for detailed representation |
| briefText | string | no | explicit placeholder marker when present | Deterministic placeholder brief representation |
| briefTokenCount | integer | no | `>= 0` when present | Token count for brief placeholder |
| briefStrategy | string | no | `deterministic_truncate_5` when present | Placeholder generation strategy for brief representation |

### Smart Compact Result

The generated PI session file uses PI's native session-file format. Feature 3 compiles emitted Thread View messages into PI-compatible runtime records rather than inventing a second generated-file format.

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| requestedLowerBound | integer | yes | `> 0` | Lower-bound target requested for this run |
| requestedBandPercentages | object | yes | valid percentage map | Per-band allocation percentages requested for this run |
| threadId | string | yes | existing Thread id | Thread compacted |
| threadViewId | string | yes | existing draft or active view id | Thread View used to produce output |
| generatedFilePath | string | yes | writable path | New generated PI session file path |
| archivePath | string | no | path when prior output existed | Archived prior generated file |
| compactStatus | enum | yes | `success`, `blocked`, `degraded`, `write_failed`, `reload_failed` | Final smart compact outcome |
| blockerCodes | array of string | no | known blocker codes | Named deterministic blockers |
| resultingTokenCount | integer | no | `>= 0` when output exists | Final generated output token count |

### Error / Blocker Codes

| Code | Description |
|------|-------------|
| SMOOTH_MISSING | Required smooth output is missing |
| SMOOTH_INVALID | Smooth output exists but is invalid or stale |
| CHUNK_STATE_INVALID | Chunk lifecycle state is inconsistent |
| CHUNK_PLACEHOLDER_MISSING | Required placeholder lower-band output is missing |
| LOWER_THRESHOLD_UNREACHED | Rebuild could not reach the requested lower-bound target |
| GENERATED_WRITE_FAILED | Generated PI session file could not be written atomically |
| PI_RELOAD_FAILED | PI reload after successful write failed |

---

## Non-Functional Requirements

### Performance

- Deterministic smooth generation, chunk updates, and placeholder lower-band generation must remain fast enough for local dogfooding workflows.
- Manual smart compact must report meaningful progress and final status within a local operator-usable timeframe.
- Threshold fixtures must be able to exercise rebuild behavior repeatedly without requiring model latency.

### Observability

- Deterministic maintenance steps must record strategy, token counts, state transitions, and blocker reasons.
- Smart compact must record generated output size, requested lower-bound target, requested band mix, archive outcome, and PI reload outcome.
- Placeholder lower-band output must remain visibly identifiable in inspection surfaces and fixtures.

### Repairability

- Missing or invalid smooth output, invalid chunk state, and missing placeholder lower-band output must be detectable and repairable without mutating source Messages or Turns.
- Deterministic rebuild and compaction failures must leave prior valid generated output intact.

### Projection Safety

- Generated PI session file writes must be atomic.
- PI reload must only run after a successful generated file write.
- Prior generated output must remain recoverable by archive when replacement succeeds.

### Persistence

- Deterministic smooth state, chunk lifecycle state, and placeholder lower-fidelity state must be persisted alongside existing Thread records rather than computed only on demand.
- Persisted deterministic maintenance state must survive process restarts so rebuild, inspection, and smart compact can continue from prior completed work.

---

## Tech Design Questions

Questions for the Tech Lead to address during design:

1. What exact deterministic smoothing format should be used for actor sections, tool markers, and optional tool-output truncation markers?
2. What exact deterministic chunk-closing policy should be used within the configured token range and hard-cap rules?
3. What exact input validation rules should apply to operator-supplied lower-bound targets and per-band allocation percentages?
4. How should deterministic placeholder 30% and 5% compression be computed so the output remains fast, stable, and easy to inspect?
5. What exact repair commands or automatic deterministic repair paths should exist for missing smooth output, invalid chunk state, and missing placeholder lower-band output?
6. How should the generated PI session file bind emitted Thread View messages into PI-compatible runtime records, especially for placeholder lower-band content?
7. What exact archive retention and cleanup policy should apply to prior generated PI session files during repeated smart compact runs?
8. How should deterministic maintenance jobs and manual smart compact share locking or revision checks so rebuild and compaction never compile from inconsistent state?

---

## Recommended Story Breakdown

### Story 0: Foundation (Infrastructure)
**Delivers:** Deterministic smoothing, chunking, placeholder lower-band, and compaction foundation types, fixtures, error codes, compaction-input helpers, and test utilities.
**Prerequisite:** Epic 2 implementation complete
**ACs covered:** Shared infrastructure only
**Estimated test count:** 0 TC tests + fixture and utility validation

### Story 1: Deterministic Smooth Turns
**Delivers:** Closed Turns receive deterministic smooth output with readiness, token counts, and repairable missing/stale state.
**Prerequisite:** Story 0
**ACs covered:**
- AC-1.1 (closed Turn receives smooth output)
- AC-1.2 (smooth output preserves readable actor structure)
- AC-1.3 (deterministic normalization and tool-output handling)
- AC-1.4 (smooth missing/stale state is visible and repairable)
**Estimated test count:** 8 tests

### Story 2: Deterministic Chunk Lifecycle
**Delivers:** One open Chunk per Thread, chunk eligibility from deterministic readiness rules over closed smooth Turns, deterministic chunk growth, and deterministic chunk closure.
**Prerequisite:** Story 1
**ACs covered:**
 - AC-2.1 (chunk eligibility by deterministic readiness)
- AC-2.2 (one open Chunk invariant)
- AC-2.3 (append eligible Turns in order)
- AC-2.4 (deterministic chunk closure)
- AC-2.5 (inspectable stable chunk state)
**Estimated test count:** 11 tests

### Story 3: Placeholder Lower-Fidelity Outputs
**Delivers:** Closed Chunks receive deterministic 30% and 5% placeholder representations with explicit markers and token accounting.
**Prerequisite:** Story 2
**ACs covered:**
- AC-3.1 (placeholder detailed representation)
- AC-3.2 (placeholder brief representation)
- AC-3.3 (deterministic and regenerable output)
- AC-3.4 (token accounting and strategy metadata)
**Estimated test count:** 8 tests

### Story 4: Deterministic Band Rebuild
**Delivers:** The steward rebuilds a draft Thread View from explicit per-run compaction inputs using deterministic full-fidelity, smooth, detailed, and brief allocation rules.
**Prerequisite:** Story 3
**ACs covered:**
- AC-4.1 (rebuild eligibility)
- AC-4.2 (full-fidelity allocation)
- AC-4.3 (smooth allocation)
- AC-4.4 (closed-Chunk lower-band allocation)
- AC-4.5 (materialized emitted sequence)
- AC-4.6 (lower-threshold target and explicit failure)
**Estimated test count:** 13 tests

### Story 5: Manual Smart Compact And PI Reload
**Delivers:** Manual smart compact accepts explicit per-run compaction inputs, verifies deterministic prerequisites, writes generated PI session output atomically, archives prior output, reloads PI, and preserves source/projection distinction.
**Prerequisite:** Story 4 and Story 6 blocker/status infrastructure available
**ACs covered:**
- AC-5.1 (run inputs and prerequisite checks)
- AC-5.2 (atomic write)
- AC-5.3 (archive prior output)
- AC-5.4 (PI reload)
- AC-5.5 (source/projection distinction)
- AC-5.6 (success with deterministic placeholder lower bands)
**Estimated test count:** 15 tests

### Story 6: Blocked And Degraded Deterministic Maintenance State
**Delivers:** Deterministic maintenance blockers, invalid state, threshold failures, and placeholder status remain explicit and inspectable.
**Prerequisite:** Story 4
**ACs covered:**
- AC-6.1 (explicit blocked deterministic prerequisites)
- AC-6.2 (invalid state reporting)
- AC-6.3 (threshold failure reporting)
- AC-6.4 (inspectable blocked and failed state)
- AC-6.5 (placeholder output remains explicit)
**Estimated test count:** 10 tests

---

## Validation Checklist

- [ ] User Profile has all four fields + Feature Overview
- [ ] Flows cover all paths needed for deterministic maintenance and smart compact behavior
- [ ] Every AC is testable and free of vague language
- [ ] Every AC has at least one TC
- [ ] TCs cover happy path, boundary rules, blocked states, and failure reporting
- [ ] Data contracts are fully specified at meaningful local system boundaries
- [ ] Scope boundaries are explicit and preserve the Epic 3 / Epic 4 split
- [ ] Story breakdown covers all ACs
- [ ] Stories sequence logically from deterministic derivation to operator-driven compaction
- [ ] Self-review complete
