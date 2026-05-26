# Epic 6: SQLite Persistence

This epic defines the requirements for moving managed Long Horizon thread state from file-backed JSON/JSONL storage into transactional SQLite persistence while preserving PI rollout JSONL as the generated runtime projection.

---

## Onboarding Context

PI Long Horizon keeps a canonical Thread for a managed PI coding session. The canonical Thread is the source of truth. It contains captured prompts, assistant responses, tool results, runtime notes, prompt-bounded turns, derived memory artifacts, token metadata, readiness state, and projection metadata.

The current implementation stores managed state under `.context-steward/threads/<threadId>/` using JSON and JSONL files. Important current files include:

- `thread.json` — thread identity, source revision, target/generated session metadata, status summaries.
- `messages.jsonl` — canonical captured messages and message parts.
- `turns.json` — prompt-bounded turns, turn lifecycle, smooth artifacts, lower-band projection metadata, token metadata.
- `chunks.json` — grouped closed turns, smooth chunk state, lower-band detailed/brief artifacts, token metadata.
- generated `projection_...thread_view_....jsonl` files — PI-facing rollout/session projections produced by smart compact.

These files mix canonical and derived managed state with whole-file JSON writes and optimistic revision checks. Runtime capture, message finalization, turn lifecycle, async maintenance, token repair, smoothing, chunking, lower-band repair, and projection metadata updates can touch related files near the same time. Stale-write conflicts are expected under this model and currently require careful retry/debt handling.

This epic changes the managed thread source substrate. SQLite becomes the managed per-thread source artifact. Generated PI rollout JSONL remains file-based because PI reads, appends, and sometimes edits that runtime projection. The rollout file is disposable: smart compact, repair, or recovery can regenerate it from managed thread state.

---

## User Profile

**Primary User:** Long Horizon operator / tech lead maintaining managed PI sessions.

**Context:** The operator runs long PI coding sessions, smart compacts them, inspects readiness and memory state, repairs derived artifacts, and expects source history to survive async maintenance, reloads, crashes, and migration.

**Mental Model:** "The thread database is the managed source of truth. PI rollout JSONL is the current runtime projection and can be regenerated."

**Key Constraint:** PI still consumes and appends JSONL session/rollout files, so Long Horizon must preserve generated JSONL output while moving managed canonical and derived state into SQLite.

**Secondary Users:**

- PI extension runtime that captures activity and schedules bounded maintenance.
- `lhx` inspection/reporting commands that read managed state.
- Smart compact and repair operations that build or refresh generated projections.
- Future migration/debug tooling that imports, exports, snapshots, or validates thread state.

---

## Feature Overview

Managed thread state moves into a transactional SQLite-backed store. Canonical messages, turns, chunks, derived artifacts, token metadata, readiness state, repair state, and projection metadata are stored in the thread database. Smart compact continues to produce a PI-facing rollout JSONL file from managed state. Existing file-backed threads can be imported and validated. Operators can inspect migrated state and regenerate rollout files without relying on stale JSON state.

Flow summary:

- [Managed Thread Entity Coverage](#1-managed-thread-entity-coverage) — define the thread entities SQLite-backed persistence must preserve. AC: `1.1-1.10`
- [Migration From File-Backed Threads](#2-migration-from-file-backed-threads) — import existing `.context-steward` thread state without losing canonical or derived data. AC: `2.1-2.5`
- [Runtime Capture, Attach, And Canonical Writes](#3-runtime-capture-attach-and-canonical-writes) — create or open managed threads, attach/import unmanaged PI sessions, and write new source activity through the SQLite-backed store transactionally. AC: `3.1-3.6`
- [Async Maintenance And Repair Writes](#4-async-maintenance-and-repair-writes) — update derived state incrementally without corrupting source truth or hiding repair debt. AC: `4.1-4.6`
- [Smart Compact And Rollout Regeneration](#5-smart-compact-and-rollout-regeneration) — generate and regenerate PI rollout JSONL from SQLite-managed state. AC: `5.1-5.5`
- [Inspection, Reporting, And Readiness](#6-inspection-reporting-and-readiness) — make `lhx` and status tooling read the SQLite-backed state accurately. AC: `6.1-6.5`
- [Snapshot, Export, And Compatibility](#7-snapshot-export-and-compatibility) — preserve portable debugging and fixture workflows. AC: `7.1-7.5`

---

## Scope

### In Scope

- SQLite-backed managed thread source artifact.
- Store abstraction or compatibility layer that lets runtime, repair, compact, and inspection operations use the managed store without direct JSON-file assumptions.
- Import/migration from existing `.context-steward/threads/<threadId>` file layout.
- Canonical message, part, actor, and turn preservation.
- Derived state preservation for smooth artifacts, chunks, lower-band artifacts, token metadata, readiness, repair status, and projection metadata.
- Runtime capture and turn lifecycle writes through SQLite-backed persistence.
- New SQLite-backed thread creation for previously unmanaged sessions.
- Attach/import of unmanaged PI sessions after SQLite cutover.
- Async maintenance and manual repair updates through SQLite-backed persistence.
- Smart compact reading from SQLite-backed managed state and writing generated PI rollout JSONL.
- `lhx` inspection/reporting against SQLite-backed state.
- Snapshot/export format that includes managed SQLite state and generated rollout artifacts.
- Legacy file-store compatibility for fixtures, import, validation, or explicit export during transition.

### Out of Scope

- Replacing PI's own runtime/session JSONL format.
- Removing generated PI rollout JSONL.
- A web workbench or visual database browser.
- New provider/model support.
- Broad smart compact UX/progress redesign beyond behavior needed for SQLite-backed operation.
- LLM wiki/KB work.
- Arbitrary manual memory curation workflows beyond preserving existing supported repair/import/export behavior.
- Full public npm publishing/name decisions.

### Assumptions

| ID | Assumption | Status | Owner | Notes |
|----|------------|--------|-------|-------|
| A1 | A thread-local SQLite database is the preferred managed source artifact. | Proposed | Tech Lead | Tech Design may confirm one DB per thread or justify another SQLite layout. |
| A2 | Generated PI rollout JSONL remains outside SQLite. | Validated | Tech Lead | PI consumes/appends JSONL; Long Horizon treats it as projection output. |
| A3 | Existing file-backed thread data can be imported deterministically. | Unvalidated | Tech Lead | Migration must report lossy, missing, or inconsistent records. |
| A4 | Existing inspection/reporting behavior can be preserved while changing store backing. | Unvalidated | Tech Lead | `lhx` outputs should remain behaviorally comparable before and after migration. |
| A5 | SQLite improves write granularity and transactionality enough to retire active JSON whole-file writes. | Proposed | Tech Lead | Exact transaction boundaries belong in Tech Design. |

---

## Flows & Requirements

### 1. Managed Thread Entity Coverage

SQLite-backed persistence preserves the managed thread entities and relationships required by capture, repair, compact, inspection, and export. The epic defines entity requirements, not SQL tables.

#### Acceptance Criteria

**AC-1.1:** Thread identity and lifecycle state are preserved.

- **TC-1.1a:** Given an existing thread, when migrated or stored in SQLite-backed persistence, then thread ID, project/root identity, source revision, creation/update timestamps, active target/session linkage, and status summaries are preserved or explicitly reported as unavailable.
- **TC-1.1b:** Given source revision changes, when canonical or derived writes occur, then inspection can distinguish current managed state from older generated projection metadata.
- **TC-1.1c:** Given PI session identity maps to a managed thread before migration, when migration and cutover complete, then PI session → managed thread resolution still works and does not depend on a loose JSON mapping as the only authoritative source.

**AC-1.2:** Actor identity is preserved.

- **TC-1.2a:** Given captured user, assistant, tool, system, or runtime-note actors in file-backed state, when migration runs, then actor identity, actor type, and source mapping are preserved for duplicate detection and audit.
- **TC-1.2b:** Given new runtime activity after cutover, when actors are declared or reused, then actor identity, actor type, and source mapping remain stable for duplicate detection and audit.
- **TC-1.2c:** Given migrated actor records contain duplicate slugs, conflicting types, or ambiguous source mappings, when migration runs, then the conflict is reported and resolved according to migration policy rather than silently merging incompatible actors.

**AC-1.3:** Canonical messages and parts are preserved as ordered source truth.

- **TC-1.3a:** Given canonical messages with ordered parts, when migrated or written, then message order, source order, source revision, actor, message kind, timestamps, part order, part type, and content are preserved.
- **TC-1.3b:** Given large tool results, when migrated or written, then full canonical content is preserved even if prompt-visible projections later truncate it.

**AC-1.4:** Turns preserve prompt-bounded semantic grouping.

- **TC-1.4a:** Given open and closed turns, when migrated or written, then turn identity, numeric index, lifecycle state, source message span, actor/prompt boundary relationships, repair status, and token metadata are preserved.
- **TC-1.4b:** Given incomplete or inconsistent turn membership, when inspected after migration, then the inconsistency is surfaced as repair-needed state rather than silently corrected without report.

**AC-1.5:** Smooth turn artifacts preserve derived content and provenance.

- **TC-1.5a:** Given a smooth artifact, when migrated or regenerated, then the smooth text/content, provenance, source revision or input references, token metadata, stale/dirty state, and provider metadata where available are preserved.
- **TC-1.5b:** Given canonical source changes that invalidate a smooth artifact, when inspected, then dependent smooth state is marked stale or repair-needed.

**AC-1.6:** Chunks preserve grouped closed-turn state.

- **TC-1.6a:** Given chunk state, when migrated or updated, then chunk ID, turn range, lifecycle state, source turn membership, smooth chunk content, token metadata, and readiness status are preserved.
- **TC-1.6b:** Given a chunk affected by turn/artifact changes, when maintenance runs, then chunk readiness reflects the affected state without rewriting unrelated source records.

**AC-1.7:** Lower-band artifacts preserve detailed/brief projections and provenance.

- **TC-1.7a:** Given detailed and brief lower-band artifacts, when migrated or regenerated, then artifact text, band type, source chunk, provider/model metadata, prompt version, token metadata, stale state, and failure state are preserved.
- **TC-1.7b:** Given a legacy placeholder or artifact missing required provenance, when prepare or repair evaluates readiness, then the artifact is treated according to current readiness policy and can be regenerated.

**AC-1.8:** Token counts preserve source, trust, and repair state.

- **TC-1.8a:** Given raw, smooth, lower-band, chunk, or generated token counts, when migrated or written, then exact vs heuristic status, count source, trust class, provider/model/encoding metadata, and measured value are preserved.
- **TC-1.8b:** Given missing, heuristic, stale, or failed token counts, when inspected, then tokenCounting readiness and blockers reflect the remaining debt.

**AC-1.9:** Projection and rollout metadata are preserved separately from rollout file content.

- **TC-1.9a:** Given generated thread-view metadata, when migrated or written, then generated file path, projection ID, source revision, band layout, generated token count, status, and timestamps are preserved.
- **TC-1.9b:** Given a missing generated rollout file, when inspected, then managed projection metadata remains readable and the missing file is reported as a warning or blocker according to current policy.

**AC-1.10:** Repair, degraded, and readiness issues are preserved.

- **TC-1.10a:** Given repair-needed, degraded, warning, or blocker issues, when migrated or updated, then issue code, scope, affected entity, severity, message, status, and relevant metadata are preserved.
- **TC-1.10b:** Given a repair operation that resolves debt, when inspected, then resolved readiness state no longer reports stale blockers while preserving enough audit information to understand what changed.

### 2. Migration From File-Backed Threads

Existing file-backed managed threads can be imported into SQLite-backed persistence with validation and explicit reporting.

#### Acceptance Criteria

**AC-2.1:** Migration imports canonical source records without loss.

- **TC-2.1a:** Given a file-backed thread with canonical messages and parts, when migration runs, then migrated message and part counts match the file-backed source unless the migration report identifies specific rejected records.
- **TC-2.1b:** Given canonical full tool-result content, when migration runs, then full content remains available from managed state after migration.
- **TC-2.1c:** Given repository-level identity files such as project indexes or PI session → thread ID maps, when migration runs, then required session/thread lookup state is migrated, preserved, or replaced by an explicit managed-store lookup and any remaining file index is non-authoritative discovery metadata.

**AC-2.2:** Migration imports derived artifacts and status where valid.

- **TC-2.2a:** Given file-backed turns, chunks, smooth artifacts, lower-band artifacts, and token metadata, when migration runs, then valid derived state is imported with provenance and readiness metadata.
- **TC-2.2b:** Given missing, stale, legacy, or invalid derived state, when migration runs, then the migration report marks affected records as skipped, downgraded, stale, or repair-needed rather than pretending they are ready.

**AC-2.3:** Migration preserves projection metadata without treating generated JSONL as source truth.

- **TC-2.3a:** Given generated projection metadata and rollout files, when migration runs, then metadata is imported and rollout file paths are preserved or remapped.
- **TC-2.3b:** Given generated JSONL content that differs from canonical managed state, when migration runs, then canonical managed state wins and the difference is reported if it affects current projection validity.

**AC-2.4:** Migration is idempotent or safely repeatable.

- **TC-2.4a:** Given a completed migration, when migration is run again against the same source and target, then it does not duplicate canonical messages, turns, chunks, or artifacts.
- **TC-2.4b:** Given a failed or interrupted migration, when migration is retried, then it resumes or restarts safely and reports any partial state handling.

**AC-2.5:** Migration produces a validation report.

- **TC-2.5a:** Given a migration run, when it completes, then the report includes source thread ID, target database path, imported counts, skipped counts, warnings, blockers, generated rollout linkage, and readiness summary.
- **TC-2.5b:** Given migration warnings or blockers, when the operator reviews the report, then affected entity IDs or ranges are included where available.

### 3. Runtime Capture, Attach, And Canonical Writes

New PI runtime activity writes canonical source state through the SQLite-backed store. Previously unmanaged PI sessions can be attached or imported after cutover without returning to file-backed source truth.

#### Acceptance Criteria

**AC-3.1:** Runtime capture appends canonical messages transactionally.

- **TC-3.1a:** Given a finalized PI prompt, response, tool result, or runtime note, when capture writes it, then message, parts, actor reference, source order, and source revision update together.
- **TC-3.1b:** Given duplicate finalized runtime activity, when capture receives it again, then canonical state remains idempotent and does not duplicate source messages.
- **TC-3.1c:** Given PI starts in a project with no existing managed thread for the active session, when the first managed capture occurs, then a SQLite-backed thread, session linkage, required actors, and first canonical message are created transactionally.

**AC-3.2:** Turn lifecycle updates remain consistent with captured messages.

- **TC-3.2a:** Given captured messages that open or close a prompt-bounded turn, when turn lifecycle state updates, then turn membership and source message references remain consistent.
- **TC-3.2b:** Given capture succeeds but derived turn update cannot complete, when inspected, then canonical messages remain present and turn repair-needed state is visible.

**AC-3.3:** Canonical source writes are not blocked by stale derived maintenance writes.

- **TC-3.3a:** Given background maintenance is repairing token counts or artifacts, when new source activity is captured, then canonical source capture succeeds or fails independently with an explicit source-write error.
- **TC-3.3b:** Given derived maintenance detects a conflict with newer source state, when it retries or yields, then it does not roll back or corrupt canonical source messages.

**AC-3.4:** Capture failures are explicit and recoverable.

- **TC-3.4a:** Given a failed canonical write, when capture reports the failure, then the error identifies the operation, thread, affected source event if available, and whether retry/import/repair is required.
- **TC-3.4b:** Given a transient store conflict or busy state, when capture retries according to policy, then success or final failure is observable.

**AC-3.5:** Restart/reopen preserves active managed state.

- **TC-3.5a:** Given a PI session is restarted after SQLite-backed capture has written state, when Long Horizon opens the thread, then canonical messages, turns, status, and projection linkage are restored from SQLite-managed state.
- **TC-3.5b:** Given capture wrote canonical messages but turn lifecycle update did not complete before restart, when Long Horizon reopens the thread, then canonical messages remain present and affected turn state is marked repair-needed or reconstructed according to repair policy.
- **TC-3.5c:** Given PI appended to the generated rollout after the last compact, when Long Horizon restarts, then managed canonical state and generated rollout linkage are reconciled without treating older projection metadata as current canonical truth.
- **TC-3.5d:** Given a crash occurs during async maintenance, when Long Horizon reopens the thread, then partially completed derived work is either visible as committed state or repair-needed debt; canonical source state remains intact.

**AC-3.6:** Attach/import of unmanaged PI sessions works after SQLite cutover.

- **TC-3.6a:** Given an existing PI session that was not previously managed by Long Horizon, when attach/import runs after SQLite cutover, then imported canonical messages, actors, turns where derivable, target/session linkage, and import status are written to SQLite-backed managed state.
- **TC-3.6b:** Given attach/import encounters unsupported, lossy, duplicate, or partially ordered PI records, when it completes, then the import report identifies affected records and leaves the managed thread in an inspectable ready or repair-needed state.

### 4. Async Maintenance And Repair Writes

Async maintenance and repair update derived state through SQLite-backed persistence without becoming source truth.

#### Acceptance Criteria

**AC-4.1:** Background maintenance performs bounded derived repair.

- **TC-4.1a:** Given newly affected turns or chunks, when background maintenance runs, then it repairs only the configured bounded set and leaves remaining debt visible.
- **TC-4.1b:** Given no affected derived state, when background maintenance runs, then it exits without changing readiness or projection metadata unnecessarily.

**AC-4.2:** Manual repair can perform full catch-up.

- **TC-4.2a:** Given historical repair debt, when the manual repair operation runs, then it attempts full catch-up for eligible dirty turns, chunks, artifacts, and token metadata.
- **TC-4.2b:** Given provider or token-counter failures during manual repair, when the operation completes, then failures are persisted and reported without generating or reloading a PI rollout unless explicitly requested by a separate operation.

**AC-4.3:** Derived writes are granular and retryable.

- **TC-4.3a:** Given token repair updates one affected turn, when it commits, then unrelated turns are not rewritten as a requirement of the update.
- **TC-4.3b:** Given a transient store contention event, when derived repair retries or defers, then repair-needed state remains visible and the next maintenance pass can continue.

**AC-4.4:** Exact token repair preserves trust metadata.

- **TC-4.4a:** Given heuristic or missing token counts, when exact provider-backed counting succeeds, then count value, source, trust class, provider/model/encoding metadata, and affected entity are persisted.
- **TC-4.4b:** Given exact token repair only partially completes, when readiness is inspected, then tokenCounting remains repair-needed for unresolved affected records.

**AC-4.5:** Artifact invalidation propagates to dependent state.

- **TC-4.5a:** Given a smooth turn artifact changes, when dependent chunk or lower-band artifacts become stale, then affected readiness/debt is marked without silently serving invalid dependent artifacts as ready.
- **TC-4.5b:** Given lower-band detailed/brief artifacts are regenerated, when readiness is inspected, then provider provenance and token metadata reflect the regenerated artifact.

**AC-4.6:** Maintenance status is inspectable.

- **TC-4.6a:** Given background or manual maintenance runs, when inspected, then last run status, fixed/skipped/failed counts, remaining debt, and blocker summaries are available at the thread level.
- **TC-4.6b:** Given specific turns, chunks, artifacts, or token records still have maintenance debt, when inspected, then affected entity IDs or ranges and debt categories are visible where available.
- **TC-4.6c:** Given background bounded maintenance and manual full repair both run, when inspected, then their results are distinguishable enough to tell whether remaining debt is expected bounded backlog, provider failure, invalid state, or manual repair failure.

### 5. Smart Compact And Rollout Regeneration

Smart compact reads SQLite-managed state and writes PI-facing rollout JSONL as a generated projection.

#### Acceptance Criteria

**AC-5.1:** Smart compact builds projection from managed source state.

- **TC-5.1a:** Given SQLite-backed managed state, when smart compact runs, then it selects full, smooth, detailed, and brief content from managed canonical and derived entities rather than from a prior generated rollout file.
- **TC-5.1b:** Given an older generated rollout exists, when smart compact runs again, then the new projection is based on current managed source state and current readiness policy.

**AC-5.2:** Strict compact respects readiness blockers.

- **TC-5.2a:** Given missing or untrusted required token/artifact metadata, when strict smart compact runs, then it blocks or degrades according to existing policy and reports the blocker.
- **TC-5.2b:** Given ready managed state, when strict smart compact runs, then it does not require a full prepare repair first.

**AC-5.3:** Prepare compact performs full catch-up before projection.

- **TC-5.3a:** Given repairable derived debt, when smart compact runs in prepare mode, then it attempts full eligible repair before generating the rollout.
- **TC-5.3b:** Given unresolved provider or artifact failures after prepare, when projection proceeds or blocks, then degraded/repair-needed status is recorded and reported.

**AC-5.4:** Generated rollout JSONL remains regenerable.

- **TC-5.4a:** Given the current rollout JSONL is missing or archived, when regeneration runs from managed SQLite state, then a valid PI-facing rollout JSONL can be produced if required artifacts are ready.
- **TC-5.4b:** Given regeneration succeeds, when inspected, then projection metadata records generated path, source revision, band layout, generated token count, and status.

**AC-5.5:** Prompt-visible tool-result truncation remains projection-only.

- **TC-5.5a:** Given a canonical tool result with full content, when smart compact writes a rollout that truncates prompt-visible tool output, then canonical managed content remains full-fidelity.
- **TC-5.5b:** Given generated rollout messages contain truncated tool-result projections, when inspecting canonical state, then reports distinguish canonical source scale from generated prompt-visible scale.

### 6. Inspection, Reporting, And Readiness

Inspection and reporting commands read SQLite-backed state and preserve current operator-facing semantics.

#### Acceptance Criteria

**AC-6.1:** Summary inspection reports migrated and live SQLite-backed state.

- **TC-6.1a:** Given SQLite-backed managed state, when summary inspection runs, then it reports thread identity, source revision, message counts, turn counts, chunk counts, generated rollout path if present, generated token count if present, degraded counts, and repair-needed counts.

**AC-6.2:** Token inspection distinguishes canonical, derived, and generated counts.

- **TC-6.2a:** Given SQLite-backed token metadata, when token inspection runs, then it reports raw canonical estimates/counts, tool-result scale, smooth counts, lower-band/chunk counts, exact vs heuristic status, and generated rollout token count where available.
- **TC-6.2b:** Given generated assistant usage metadata conflicts with authoritative generated-output metadata, when reported, then authoritative generated-output metadata remains the generated-session count source.

**AC-6.3:** Band inspection reports actual generated projection layout.

- **TC-6.3a:** Given a generated rollout from SQLite-backed state, when band inspection runs, then it reports full/smooth/detailed/brief selected ranges or chunks, token sums, record/message counts, and warnings for missing metadata.

**AC-6.4:** Post-compact report composes SQLite-backed inspection results.

- **TC-6.4a:** Given a post-compact report request, when the report runs, then it composes summary, token, band, status, warning, and mismatch information without mutating managed state.

**AC-6.5:** Inspection handles missing generated rollout files gracefully.

- **TC-6.5a:** Given managed SQLite state with no current rollout file or a missing rollout path, when inspection runs, then it reports partial managed state and a warning rather than crashing.

### 7. Snapshot, Export, And Compatibility

SQLite-backed persistence preserves portable debugging, snapshot, and fixture workflows.

#### Acceptance Criteria

**AC-7.1:** Snapshot captures managed database and generated projection artifacts.

- **TC-7.1a:** Given a managed thread, when a snapshot is created, then it includes the thread database, current/generated rollout JSONL if present, manifest metadata, and enough counts/status to identify the snapshot later.

**AC-7.2:** Export produces an inspectable portable artifact.

- **TC-7.2a:** Given a SQLite-backed thread, when exported, then the output can be copied, archived, and inspected without relying on the original live project directory.
- **TC-7.2b:** Given export includes JSON compatibility output, when reviewed by humans or fixtures, then canonical-vs-derived-vs-projection ownership remains explicit.

**AC-7.3:** Legacy file-backed fixtures remain usable during transition.

- **TC-7.3a:** Given existing tests or fixtures in file-backed layout, when the transition begins, then they either import into SQLite-backed state or remain explicitly supported by a legacy adapter until retired.

**AC-7.4:** Active writes do not split between JSON and SQLite source truth.

- **TC-7.4a:** Given a thread has been cut over to SQLite-backed persistence, when runtime capture, maintenance, repair, compact, and inspection run, then active managed source writes do not continue to mutate legacy JSON files as a competing source of truth.

**AC-7.5:** Rollback or fallback behavior is explicit.

- **TC-7.5a:** Given a migration or cutover cannot complete, when the operator inspects state, then the system identifies whether the active source truth is still file-backed or SQLite-backed and what action is required.

---

## Data Contracts

These are boundary-level contracts. Exact SQLite tables, indexes, migrations, transaction boundaries, and SQL queries belong in Tech Design.

### Managed Thread Database Artifact

| Field / Concept | Required | Description |
|-----------------|----------|-------------|
| Thread identity | yes | Stable ID and project/root association for the managed thread. |
| Session/thread lookup | yes | PI session, target, or runtime identity mapping needed to reopen or attach the correct managed thread. |
| Canonical source records | yes | Actors, messages, message parts, source order, source revision, timestamps, provenance. |
| Turn state | yes | Prompt-bounded open/closed turns, numeric indices, source message spans, repair status. |
| Derived artifacts | yes | Smooth turn artifacts, chunk state, lower-band detailed/brief artifacts, provenance, stale state. |
| Token metadata | yes | Count values, source, exact/heuristic trust class, provider/model/encoding metadata, stale/repair state. |
| Readiness/degraded status | yes | Blockers, warnings, repair-needed state, affected entity references. |
| Projection metadata | yes | Generated rollout identity/path, source revision, band layout, generated token metadata, status. |
| Maintenance/repair state | yes | Last run status, fixed/skipped/failed counts, remaining debt, retry/failure context. |

### Generated PI Rollout JSONL

| Property | Requirement |
|----------|-------------|
| Ownership | Generated projection, not managed source truth. |
| Format | PI-readable JSONL session/rollout file. |
| Lifecycle | Created or regenerated by smart compact/recovery; PI may append/edit during active continuation. |
| Source relationship | Projection metadata links it to managed thread source revision and band layout. |
| Recovery | Can be regenerated from managed state when required artifacts are ready. |

### Migration Report

| Field | Required | Description |
|-------|----------|-------------|
| sourceThreadId | yes | File-backed source thread ID. |
| targetStorePath | yes | SQLite-backed target artifact path. |
| importedCounts | yes | Counts for messages, parts, turns, chunks, artifacts, token metadata, projection metadata. |
| skippedCounts | yes | Counts for invalid, legacy, missing, or unsupported records. |
| warnings | yes | Non-blocking issues and affected entity references where available. |
| blockers | yes | Issues that prevent safe cutover or require repair. |
| readinessSummary | yes | Post-migration degraded/repair-needed status. |
| generatedRollout | optional | Current/generated rollout linkage if present. |

### Snapshot / Export Manifest

| Field | Required | Description |
|-------|----------|-------------|
| snapshotId | yes | Stable snapshot identifier. |
| createdAt | yes | ISO timestamp. |
| threadId | yes | Managed thread ID. |
| sourceRevision | yes | Managed source revision at snapshot time. |
| databasePath | yes | Path to included thread database artifact. |
| rolloutPath | optional | Path to included generated/current PI rollout JSONL. |
| counts | yes | Message, turn, chunk, generated record/message, and token summary counts where available. |
| status | yes | Degraded/repair-needed summary. |
| notes | optional | Human-readable snapshot context. |

---

## Dependencies

Technical dependencies:

- SQLite library/runtime choice for Node.
- Existing file-backed store readers for import and validation.
- Existing smart compact, async maintenance, repair, and `lhx` inspection services.
- PI runtime continuation behavior through generated JSONL rollout/session files.

Process dependencies:

- Tech Design answers schema, transaction, migration, and compatibility questions before implementation stories are published.
- Existing root verification baseline is green or known-red blockers are explicitly documented.

---

## Non-Functional Requirements

### Durability

- Canonical source records must survive process restart, PI reload, migration retry, and generated rollout regeneration.
- Source capture failures must be explicit and recoverable.

### Concurrency

- Canonical capture and derived maintenance must not corrupt each other.
- Derived repair conflicts must become retryable debt or explicit failure state, not silent data loss.
- SQLite-backed writes should reduce whole-file stale-write conflict classes present in JSON storage.

### Inspectability

- Operators must be able to inspect thread status, token counts, readiness, band layout, generated rollout metadata, and migration results without opening implementation internals.
- Snapshot/export artifacts must remain understandable outside the live process.

### Migration Safety

- Migration must preserve canonical data first.
- Derived data can be marked stale or repair-needed if validity cannot be proven.
- Cutover must make the active source-of-truth store explicit.

### Performance

- Long-thread inspection and maintenance should avoid full-file rewrite behavior for small derived updates.
- Smart compact over ready managed state should remain fast relative to prepare/repair catch-up.

---

## Tech Design Questions

Questions for Tech Design:

1. What current code paths read and write each managed file, and what contention surfaces must the new store design eliminate or preserve as retryable debt?
2. Should SQLite be one database per thread, one database per project, or another layout?
3. What is the exact schema for threads, actors, messages, parts, turns, chunks, artifacts, token metadata, statuses, projections, and maintenance state?
4. What transaction boundaries protect canonical capture, turn lifecycle updates, and derived maintenance updates?
5. How are source revisions represented once active JSON files are retired?
6. How does the store abstraction preserve current file-backed tests and fixtures during transition?
7. What migration strategy handles partial migration, repeat migration, rollback, session/thread identity mapping, and validation reports?
8. How are generated rollout paths represented when files are archived, missing, regenerated, or live-appended by PI?
9. What SQLite library and busy/retry policy should Node use?
10. Which existing services can be adapted directly, and which require query/API reshaping to avoid JSON-file assumptions?
11. How should snapshot/export support both human inspection and future fixture generation?
12. What compatibility period remains for file-backed stores after SQLite cutover?
13. How should tests compare file-backed and SQLite-backed behavior without brittle full-output snapshots?

---

## Recommended Story Breakdown

The Tech Design phase should inspect the current codebase in detail and document the current file layout, writer/read paths, contention surfaces, and migration implications before finalizing schema and implementation stories. Implementation stories should begin after that design work is complete.

### Story 0: SQLite Store Foundation And Import Read Model

**Delivers:** SQLite-backed thread artifact foundation, store boundary implementation, migration fixtures, and import/read support sufficient to inspect migrated existing threads.

**ACs covered:**

- AC-1.1 through AC-1.10
- AC-2.1 through AC-2.5
- AC-6.1 through AC-6.3 for migrated read-only state

### Story 1: Canonical Runtime Capture Cutover

**Delivers:** Runtime capture, new thread creation, attach/import, and turn lifecycle source writes through SQLite-backed persistence.

**ACs covered:**

- AC-3.1 through AC-3.6
- AC-7.4 source-truth split prevention for capture and attach/import writes

### Story 2: Derived Maintenance And Repair Cutover

**Delivers:** Async maintenance, exact token repair, smoothing, chunking, lower-band repair, and manual repair writes through SQLite-backed persistence.

**ACs covered:**

- AC-4.1 through AC-4.6
- AC-7.4 for derived writes

### Story 3: Smart Compact And Rollout Regeneration From SQLite

**Delivers:** Smart compact and rollout regeneration read SQLite-managed state and write PI-facing generated JSONL.

**ACs covered:**

- AC-5.1 through AC-5.5
- AC-6.3 through AC-6.5 where projection output is involved

### Story 4: Inspection, Reporting, Snapshot, And Export

**Delivers:** `lhx` inspection/reporting and snapshot/export workflows for SQLite-backed threads.

**ACs covered:**

- AC-6.1 through AC-6.5
- AC-7.1 through AC-7.3
- AC-7.5

### Story 5: Legacy File-Store Retirement And Compatibility Cleanup

**Delivers:** Active JSON writes are retired or quarantined; compatibility/import/export paths remain explicit.

**ACs covered:**

- AC-7.3 through AC-7.5
- Regression coverage across capture, maintenance, compact, inspection, migration, and snapshot workflows

---

## Validation Checklist

- [ ] User Profile has Primary User, Context, Mental Model, and Key Constraint.
- [ ] Onboarding context defines canonical, derived, generated, and current file-backed concepts needed by downstream readers.
- [ ] Flow summary entries match flow headings and AC ranges.
- [ ] Scope boundaries are explicit.
- [ ] Assumptions identify unvalidated storage and migration claims.
- [ ] Every AC has at least one TC.
- [ ] TCs cover migration, runtime capture, async maintenance, compact, inspection, snapshot/export, and failure behavior.
- [ ] Data contracts are boundary-level, not internal schema.
- [ ] Non-functional requirements cover durability, concurrency, inspectability, migration safety, and performance.
- [ ] Tech Design Questions capture schema/transaction/library decisions without resolving them in the epic.
- [ ] Story breakdown covers all ACs and sequences import/read before runtime write cutover.
- [ ] Self-review complete before Tech Design handoff.
