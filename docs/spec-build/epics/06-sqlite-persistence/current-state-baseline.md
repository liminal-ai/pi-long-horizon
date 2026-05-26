# Epic 6 Current-State Baseline: SQLite Persistence

Date: 2026-05-25

## Purpose

This document captures the current file-backed persistence baseline before designing the SQLite persistence epic.

It is not the SQLite design. It records the system we are replacing or preserving:

- what files exist now;
- what owns source truth versus projection;
- where known concurrency pain comes from;
- how smart compact and reporting currently behave.

The intended next architecture is likely a managed context with two primary runtime files:

```text
thread.sqlite                 canonical + derived Long Horizon state
current PI rollout .jsonl      disposable PI-facing session/projection
```

This baseline explains why that direction is attractive and what must not be lost during migration.

---

## Current Runtime Storage Layout

Today Long Horizon state lives under the project root:

```text
.context-steward/
```

Common top-level files/directories:

```text
.context-steward/index.json
.context-steward/threadId-map.json
.context-steward/threads/<threadId>/...
.context-steward/thread-backups/<threadId>-<label>-<timestamp>/...
.context-steward/debug/...
```

### `.context-steward/index.json`

Repository-level target index.

Responsibilities:

- maps PI target/session identities to managed Thread identities;
- supports reopening a managed PI session without creating a duplicate Thread;
- helps attach/import and generated rollout resolution find the correct canonical Thread.

Current concern:

- it is another file-backed mutable index that can become part of write coordination/rebuild behavior.

### `.context-steward/threadId-map.json`

Persistent map from PI session IDs/files/generated rollout identities to canonical Thread IDs.

Responsibilities:

- lets generated rollout sessions resolve back to their canonical Thread;
- allows PI `session_start` / resumed generated sessions to reconnect to managed state;
- supports retirement/reconciliation of stale generated rollout identities.

Current concern:

- identity mapping is source-of-truth-adjacent and must survive restart, generated file replacement, and import/attach flows.

### `.context-steward/threads/<threadId>/`

The current canonical Thread directory. Typical files:

```text
thread.json
messages.jsonl
actors.json
turns.json
chunks.json
imports.json
projections.json
generated/*.jsonl
*.bak / manual-edit backups where present
```

This directory is the active file-backed Thread store.

### `.context-steward/thread-backups/`

Snapshot/backup copies of Thread directories.

Responsibilities:

- preserve debug/restore points before risky operations;
- support dogfood/manual recovery workflows.

SQLite migration must preserve an equivalent snapshot/debug story.

### `.context-steward/debug/`

Operational logs/debug artifacts.

Examples seen in dogfood include provider connectivity logs, prompt/projection logs, and timing logs.

These are not source truth, but they are useful for diagnosing provider/runtime behavior.

---

## Per-Thread Files Today

### `thread.json`

Thread metadata and status record.

Owns:

- thread ID and schema version;
- target/session metadata;
- generated rollout summary metadata;
- projection revision metadata;
- status/degraded/repair-needed state;
- latest generated file references;
- token-counting/readiness summaries where recorded.

Source-truth role:

- authoritative for Thread-level metadata and current managed-target bindings;
- not authoritative for message content.

Projection role:

- records what generated/projection outputs were created and where they live;
- records generated-session token count metadata from rollout generation.

SQLite implication:

- Thread metadata, rollout metadata, projection revisions, readiness, and status should move into relational tables.
- Generated rollout file path can be retained as a binding/output pointer, not as source truth.

### `messages.jsonl`

Append-oriented canonical message/source record log.

Owns:

- full finalized PI prompts/responses/tool results/runtime notes;
- typed message parts;
- actor references;
- source order/source revision;
- source metadata, timestamps, target metadata;
- full canonical tool-result content, even when prompt-visible output is truncated.

Source-truth role:

- primary source of truth for conversation content;
- generated PI files and prompt-visible truncation must not replace it.

Projection role:

- none directly; projections are derived from it plus turn/chunk/artifact state.

Current behavior:

- new PI `message_end` events append canonical records here;
- duplicate finalized events are suppressed/idempotent;
- source order is preserved and used for reconstruction.

SQLite implication:

- messages and message parts should become relational rows.
- Appending a message should be a small transaction, not a whole-thread/snapshot mutation.

### `actors.json`

Actor identity registry.

Owns:

- user/assistant/tool/system actor declarations;
- actor identities referenced by messages.

Source-truth role:

- authoritative for actor records used by canonical messages.

Current behavior:

- actors must be declared before message records reference them;
- actor reuse/identity convergence has been a source of prior edge cases.

SQLite implication:

- actors should be rows with constraints so message references are transactional.

### `turns.json`

Canonical and derived turn state.

Owns:

- prompt-bounded turn membership;
- open/closed lifecycle state;
- member message IDs/source ranges;
- smooth turn artifacts/components;
- lower-band turn projection artifacts;
- token count metadata for raw/smooth/lower-band representations;
- turn-level repair/readiness flags.

Source-truth role:

- authoritative for derived semantic grouping of messages into turns;
- turn membership is derived from canonical messages but persisted and operationally important.

Projection role:

- smooth turn text and lower-band turn projection are derived artifacts used by smart compact and chunking.

Current behavior:

- `message_end` can close turns when final assistant output is captured;
- `turn_end` can finalize the latest open turn;
- async maintenance smooths closed turns, repairs projections, and exact-counts token metadata;
- smart compact uses turns for full-fidelity and smooth bands.

Current pain:

- `turns.json` is the main contention point.
- Multiple lifecycle/maintenance paths can read a snapshot, do work, then try to write the whole file with expected-revision semantics.
- A concurrent writer can win first, causing stale write failures like `writeTurnsFailed`.

SQLite implication:

- turns, turn membership, turn artifacts, and token counts should be row-level/transactional.
- Updating one turn's smooth/token metadata should not rewrite every turn.

### `chunks.json`

Derived chunk state.

Owns:

- ordered groups of closed turns;
- open/closed chunk lifecycle;
- chunk transcript/smooth text;
- detailed and brief lower-band semantic artifacts;
- lower-band token metadata;
- chunk-level readiness/failure status.

Source-truth role:

- derived from turns, not raw canonical source truth.

Projection role:

- detailed and brief bands select from chunk lower-band artifacts.

Current behavior:

- async maintenance updates chunk membership as turns close;
- closed chunks can schedule detailed/brief lower-band compression;
- prepare smart compact can perform catch-up for selected lower-band artifacts;
- strict smart compact blocks on missing/stale/placeholder lower-band artifacts.

Current pain:

- `chunks.json` shares the whole-file rewrite problem;
- lower-band generation does provider work before persisting artifact updates;
- artifact readiness and exact token metadata can lag normal turn capture.

SQLite implication:

- chunks, chunk membership, lower-band artifacts, and artifact failures should be relational.
- Dirty/failed artifact rows can be queried and repaired without scanning/replacing the whole file.

### `imports.json`

Import/attach metadata.

Owns:

- imported PI session path/source metadata;
- import ranges and status;
- provenance for attach/import operations.

Source-truth role:

- authoritative import history/provenance, not message content itself.

SQLite implication:

- import operations should be represented transactionally with imported message ranges.

### `projections.json`

Projection/thread-view metadata.

Owns:

- thread view/projection records and summaries;
- active/archived draft or generated projection metadata where applicable;
- band selection metadata and output references.

Source-truth role:

- not canonical conversation truth;
- authoritative metadata about generated projections.

Projection role:

- tracks generated thread-view history and current rollout state.

SQLite implication:

- projection records should move into tables.
- Generated JSONL remains an output artifact compiled from SQLite state.

### `generated/*.jsonl`

Generated PI rollout/session files.

Owns:

- PI-facing generated session content;
- compacted hidden custom messages for smooth/detailed/brief artifacts;
- raw/full-fidelity recent messages;
- PI-native session entries and appended live continuation after reload.

Source-truth role:

- not source truth.
- Disposable projection/output.
- If it disagrees with canonical Thread state, canonical state wins.

Projection role:

- active PI continuation file after smart compact/reload;
- PI appends/edits this file during normal operation;
- smart compact writes a new generated rollout and can reload PI into it.

Current behavior:

- smart compact regenerates a fresh rollout file from canonical Thread state and derived artifacts;
- PI then appends live turns/messages to that generated file;
- generated file can contain compacted projection region plus live appended tail;
- prompt-visible tool-result truncation may rewrite prompt-visible generated entries while canonical messages remain full fidelity.

SQLite implication:

- keep this as an external output artifact.
- The migration should make it cheap and reliable to regenerate from SQLite at any time.

---

## Ownership Model: Truth vs Projection

### Canonical Source Truth

Canonical truth currently includes:

- `messages.jsonl`: full source messages and typed parts;
- `actors.json`: actor identity registry;
- `thread.json`: thread identity/target/status metadata;
- `imports.json`: attach/import provenance;
- persisted turn membership/lifecycle in `turns.json`.

Principle:

```text
Canonical Thread state is authoritative. Generated PI rollout files are not.
```

### Derived Memory State

Derived state currently includes:

- smooth turn components/materialized smooth text;
- lower-band turn projections;
- chunk membership and transcripts;
- detailed/brief lower-band semantic artifacts;
- exact/heuristic token count metadata;
- readiness/blocker/degraded status.

Principle:

```text
Derived memory artifacts are important and persisted, but repairable/regenerable from canonical state plus provider/model work.
```

### Generated Projection / PI Rollout

Generated rollout files currently include:

- compacted PI-readable thread views;
- hidden custom messages for smooth/lower-band memory;
- raw recent turns;
- PI-appended live tail after reload.

Principle:

```text
Generated rollout is the active PI-facing projection. It is disposable and can be regenerated.
```

### Prompt-Visible Runtime Projection

Live prompt-visible truncation/off-gassing can reduce large tool results in the active PI prompt/rollout representation.

Principle:

```text
Prompt-visible truncation reduces runtime context pressure but never mutates canonical full tool-result content.
```

---

## Known Concurrency Pain

The current store uses file-backed JSON/JSONL plus expected-revision checks. This works for dogfood and inspectability, but creates coarse contention.

### Main contention pattern

Typical failing shape:

```text
writer A opens Thread snapshot
writer A performs work, sometimes provider/token-count work
writer B mutates turns/chunks/thread metadata first
writer A attempts whole-file write with stale expected revision
writer A fails with stale/write conflict
```

Observed/known surfaces:

- `message_end` capture appends canonical messages and may close turns;
- assistant `message_end` can close a turn before `turn_end`;
- `turn_end` finalization can close open turns;
- background maintenance smooths turns and repairs artifacts;
- token-count repair updates raw/smooth/chunk token metadata;
- chunk maintenance updates chunk membership and chunk artifacts;
- prompt-visible projection refresh can update active generated rollout files;
- prepare/manual repair can perform broader catch-up work.

### `turns.json` contention

Most visible pain:

- token repair reads turns, exact-counts raw/smooth records, then writes `turns.json`;
- turn lifecycle/capture may write turns concurrently;
- stale revision causes `writeTurnsFailed`;
- retry/fallback must preserve token-counter settings and leave repair debt visible if not repaired.

Recent mitigations:

- background artifact repair is bounded;
- background token repair is bounded;
- `prepareAsyncThread` remains full catch-up;
- manual `repairThreadMaintenance` remains full repair;
- turn-end maintenance has debounce/retry behavior;
- service and E2E tests currently pass.

Remaining architectural issue:

- bounded repair reduces blast radius but does not remove whole-file write contention.

### `chunks.json` contention

Chunk maintenance and lower-band artifact generation can update chunk state while other maintenance is running.

Current mitigations:

- lower-band repair is sequential/bounded in background;
- full catch-up is reserved for prepare/manual repair;
- provider failures persist explicit failed/pending state.

Remaining architectural issue:

- updating one chunk artifact still rewrites a whole chunk state file.

### Generated rollout file mutation

The generated PI rollout file is intentionally mutable by PI after reload.

Current behavior:

- PI appends new session entries to the rollout;
- PI may edit messages on message end;
- prompt-visible truncation can refresh/clean the active generated file;
- smart compact writes a new rollout file rather than incrementally updating old projection regions.

Important distinction:

- this is not the same as canonical store contention;
- generated rollout files should remain PI-facing and disposable.

Migration stance:

- do not put PI's active append/edit file under SQLite control;
- keep it as the current rollout output;
- make regeneration from SQLite reliable and fast.

---

## Current Smart Compact Behavior

Smart compact currently works over the canonical Thread snapshot, not over the latest generated PI rollout as source truth.

Flow summary:

1. Load canonical Thread/messages/turns/chunks/projection metadata.
2. In `prepare` mode, repair/catch up missing selected artifacts and exact token counts where needed.
3. Select full/smooth/detailed/brief bands using configured allocation weights and readiness policy.
4. Materialize a Thread View into PI session JSONL entries.
5. Apply prompt-visible tool-result truncation to raw/full-fidelity tool-result entries before final generated write/count.
6. Count generated-session tokens with provider-backed exact count.
7. Write a new generated PI rollout file under `generated/`.
8. Archive/retire previous rollout state as appropriate.
9. Record generated output metadata and reload/switch PI to the generated file.

### Band behavior

Inputs:

```text
/lh-smart-compact --lower-bound <tokens> --full <weight> --smooth <weight> --detailed <weight> --brief <weight> [--mode prepare]
```

Important semantics:

- band percentages are allocation hints/weights, not hard quotas;
- full and smooth bands select whole turns;
- detailed and brief bands select whole chunks;
- turn/chunk boundaries, readiness, token metadata, truncation, final recounts, and degradation can change final distribution.

### Strict vs prepare

Strict mode:

- trusts only ready/exact/usable artifacts;
- blocks when selected artifacts are missing/stale/heuristic where exact is required;
- does not perform broad catch-up.

Prepare mode:

- performs catch-up repair for selected missing/stale artifacts;
- can regenerate smooth/lower-band/token metadata;
- is the full safety net when background maintenance has debt.

Recent direction:

- normal background maintenance should keep state near-ready incrementally;
- prepare should be a safety net, not the routine debt payment path.

### Current healthy behavior from dogfood

Recent post-compact reports showed healthy generated state, for example:

```text
Generated tokens: exact provider_input_count
Status: degraded=0 repairNeeded=0
Bands: full/smooth/detailed/brief populated
```

Observed operator behavior:

- when there is no repair debt, smart compact can be very fast, around a few seconds in dogfood;
- slow compacts mostly correlate with accumulated repair/catch-up work.

---

## Current Report/Inspection Behavior

The `packages/lh-context` package provides the current read-only SDK/CLI inspection surface.

Primary command shape:

```bash
lhx inspect summary --root .
lhx inspect tokens --root .
lhx inspect bands --root .
lhx inspect report post-compact --root .
```

Top-level aliases remain for earlier commands:

```bash
lhx summary
lhx tokens
lhx bands
```

### Post-compact report

`lhx inspect report post-compact` composes existing inspectors and reports:

- Thread ID;
- canonical message counts by role;
- closed/open turn counts;
- closed/open chunk counts;
- generated thread-view path;
- generated exact token count and source;
- generated file record/message counts;
- degraded/repair-needed status;
- band layout and token sums;
- canonical raw/tool-result/raw-turn/smooth/generated token scale.

This report is now the standard operator sanity check after smart compact.

### Current limitations

The current inspection surface is useful but still incomplete for the SQLite migration baseline.

Missing or not yet complete:

- `lhx inspect readiness` as a clear strict/prepare signal;
- turn and chunk drilldowns (`turns`, `turn`, `chunks`, `chunk`);
- explicit live-tail accounting after compact;
- SQLite-ready query abstraction;
- snapshot/restore command flow around future `thread.sqlite + rollout` bundles.

---

## Current Validation Baseline

As of this baseline, full verification is green:

```text
npm run verify-all
```

Recent result:

- service tests: 506/506 passed;
- E2E suites: 15/15 passed;
- long-thread E2E append/continue/smart-compact tests passed.

This matters because SQLite migration should start from a known-green baseline, not from an already-red repository.

---

## What SQLite Must Preserve

SQLite migration must preserve these invariants:

1. Canonical source truth is complete and durable.
2. Generated PI rollout files remain disposable projections.
3. Full canonical tool outputs are preserved even when prompt-visible output is truncated.
4. Turns remain prompt-bounded semantic units.
5. Chunks remain ordered groups of turns.
6. Full/smooth/detailed/brief bands remain turn/chunk based.
7. Smart compact remains manual, inspectable, and able to block explicitly on degraded state.
8. Background maintenance remains bounded/incremental during normal turn operation.
9. Prepare/manual repair remain full catch-up paths.
10. Generated rollout can be regenerated from canonical/derived state at any time.
11. Attach/import can bring existing PI sessions under management.
12. Snapshot/debug/restore workflow remains legible for humans and agents.

---

## Migration Questions For The SQLite Epic

These should be answered in the ADR/tech design, not by this baseline:

1. One SQLite DB per Thread or one project-level DB?
2. What is the exact schema for messages, parts, actors, turns, chunks, artifacts, token counts, projections, and jobs?
3. How are source revisions represented transactionally?
4. How is the current PI rollout path bound to a Thread?
5. How are dirty artifact/token-count jobs represented?
6. How are provider failures persisted and retried?
7. How is current JSON store imported/migrated?
8. How are snapshots exported? `thread.sqlite + current_rollout.jsonl + metadata`?
9. What remains in `.context-steward/` after cutover?
10. What JSON file paths remain only for migration/backcompat/debug?
11. What code paths must be cut over first: capture, turns, chunks, smart compact, or inspection?
12. What temporary compatibility layer is allowed, and how do we avoid permanent dual-write?

---

## Recommended Framing For Epic 6

Epic 6 should treat SQLite as a source-of-truth substrate migration, not a cosmetic storage refactor.

The target model should be:

```text
.context-steward/threads/<threadId>/thread.sqlite
.context-steward/threads/<threadId>/generated/<current-rollout>.jsonl
```

or equivalent, where:

- `thread.sqlite` owns canonical and derived Long Horizon state;
- generated JSONL owns only the active PI-facing rollout;
- JSON files from the current store become migration/import/debug artifacts;
- smart compact can regenerate the rollout from SQLite at any time.

The major architectural cleanup is not just fewer files. It is clearer authority:

```text
SQLite = Long Horizon memory truth
PI rollout JSONL = current PI interface artifact
```
