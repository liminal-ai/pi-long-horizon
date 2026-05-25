# PI Long Horizon Codebase Assessment

Date: 2026-05-25

## Summary

PI Long Horizon is close to MVP, but the next hardening step should be architectural, not cosmetic.

The core design is good:

- preserve full canonical conversation history;
- continuously derive smooth/chunk/lower-band artifacts during normal operation;
- make smart compact fast by selecting/rendering already-prepared artifacts;
- regenerate the PI rollout/session file on smart compact;
- let PI append to that rollout file until the next compact.

The biggest issue is not smart compact itself. The rollout replacement path appears conceptually clean and should stay whole-file regeneration for now.

The real pressure point is **normal turn operation**: message-end/turn-end capture, live tool-result trimming, derived artifact generation, token accounting, and maintenance scheduling can overlap. The current file-backed JSON persistence model makes those overlaps harder to reason about and has already produced concurrency/persistence bugs.

Given that, the recommended next major move is:

> Migrate canonical and generated thread state to a per-thread SQLite database, while keeping the PI rollout file as a regenerated PI-facing artifact.

Do not spend major effort deeply refactoring the current large JSON/file-store modules first. SQLite changes the storage model, transaction boundaries, job model, and query model. Refactor the large files after the new persistence shape is in place.

Validation notes from the review:

- Root `npm run typecheck` passed.
- `packages/lh-context` typecheck, tests, and build passed.
- Root `npm test` exposed one failing service test related to concurrent smooth-turn persistence.
- `repo-ref/pi` was pulled and inspected during review.
- Historical epics/docs were treated as useful context, not current-state truth.

---

# Priority roadmap

## P0 — Immediate hardening before the SQLite cutover

### 1. Keep smart compact rollout replacement intact

Smart compact should continue to regenerate/replace the PI rollout/session file as a whole.

Do not introduce targeted patching or append logic for the rollout file. That file is PI's active working projection. It should remain:

- generated from canonical/derived state;
- appended to by PI during live operation;
- replaced by the next smart compact;
- not treated as canonical truth.

If rollout and canonical state disagree, canonical state wins and the next compact regenerates the rollout.

### 2. Fix or quarantine the current smooth-turn concurrency failure

Evidence: root `npm test` fails on:

```text
isolated smooth-turn writers retry instead of clobbering stale whole-snapshot state
```

Relevant code:

- `src/thread/async-thread/services/smooth-turn-service.ts`
- `src/thread/store/file-thread-store.ts`
- `tests/thread/smooth-turn-service.test.ts`

This is a real bug class: async derived work can start from one view of the thread, finish later, and attempt to commit after capture or another maintenance task changed state.

Short-term fix:

- ensure derived artifact commits re-read latest state inside the serialized mutation;
- update only the intended artifact;
- avoid stale whole-snapshot rewrites;
- keep canonical capture stricter than derived artifact persistence.

Do not overbuild this in the JSON store if SQLite migration is imminent. Fix enough to keep tests and dogfooding safe.

### 3. Establish CI before large migration work

Minimum CI:

```sh
npm run typecheck
npm test
npm --prefix packages/lh-context run typecheck
npm --prefix packages/lh-context test
npm --prefix packages/lh-context run build
```

Optional/nightly:

```sh
npm run test:e2e
```

Also add guards for:

- focused tests;
- newly tracked runtime/session artifacts;
- accidental package/runtime state committed to source.

### 4. Document current persisted schema before replacing it

Before migration, write current-state notes for:

- `.context-steward/threads/<id>/thread.json`
- `messages.jsonl`
- `turns.json`
- `chunks.json`
- projection revisions
- generated PI session metadata entries

This is not to preserve JSON forever. It is to make migration safe and testable.

---

## P1 — SQLite migration design

This is the main architectural move.

### 5. Define the per-thread SQLite model

Each canonical thread should have one SQLite database containing canonical and generated/derived state.

Likely categories:

- thread metadata;
- actors;
- canonical messages/tool results;
- turns;
- smooth turn artifacts;
- user-prompt smoothing artifacts;
- chunks;
- chunk transcripts;
- detailed/brief lower-band artifacts;
- token counts and provenance;
- maintenance jobs/attempts;
- operational events;
- projection/smart-compact revision metadata;
- target/session binding metadata where appropriate.

The PI rollout/session file remains outside SQLite for now.

### 6. Define transaction boundaries around real conflicts

The most important transaction boundaries are around message-end and turn-end behavior.

Message-end should be ordered as:

1. capture full canonical raw message/tool result;
2. persist fingerprints/source revision metadata;
3. enqueue or update maintenance state;
4. apply prompt-visible trimming as projection/runtime behavior, not canonical replacement.

Derived artifacts should record the source revision/content hash they were generated from. If the source changed incompatibly, the artifact is stale and should retry or be regenerated.

### 7. Design durable maintenance records

The current process-local scheduling and `inFlight` guards are not enough for long sessions.

SQLite should make maintenance visible and durable:

- queued/running/succeeded/failed status;
- attempts;
- source revision;
- target turn/chunk/artifact;
- provider/model metadata;
- last error;
- timestamps.

This does not require a complex worker system immediately. The point is to make background work transactional, inspectable, and resumable.

### 8. Design the JSON-to-SQLite migration utility

A migration utility is required.

It should:

- read an existing JSON thread directory;
- validate expected files;
- create the per-thread SQLite database;
- import canonical and derived state;
- verify counts/hashes after import;
- leave original JSON untouched;
- report migration status clearly.

Preferred behavior:

- explicit migration command first;
- no silent half-migration during active runtime;
- later optional auto-migration only after the utility is trusted.

---

## P2 — Build the SQLite replacement path

### 9. Implement SQLite as the canonical store for new/active threads

Build the SQLite store as the new source of truth, not as a long-term parallel backend.

JSON should become:

- migration input;
- fixture import source;
- legacy compatibility path for old data;
- not the active write path after cutover.

Avoid permanent dual-write. It creates reconciliation bugs and false confidence.

### 10. Wire runtime capture and maintenance to SQLite

The active runtime path should use SQLite for:

- canonical message capture;
- turn state;
- derived artifact commits;
- chunk/lower-band state;
- token counts;
- maintenance jobs/events;
- projection revision metadata.

This is where the concurrency model improves. Derived work commits become small transactions instead of stale JSON rewrites.

### 11. Keep smart compact as render-from-store

Smart compact should read SQLite-backed canonical/derived state, select bands, render the rollout file, and switch PI to it.

The compact operation should get faster and cleaner because most expensive derived text was prepared earlier during normal operation.

Do not move PI's live rollout mechanics into SQLite unless/until the PI integration model changes substantially.

### 12. Cut over tests and fixtures

Move the main service tests to the SQLite-backed path.

Use JSON fixtures through migration/import where useful, but the primary runtime tests should validate the new path directly.

Cutover condition:

- SQLite path passes the existing service suite;
- smart compact still regenerates rollout correctly;
- package inspection still works or has a clear migrated equivalent;
- JSON write path is deleted, disabled, or moved under legacy/import.

---

## P3 — Refactor large files after SQLite lands

SQLite should simplify later decomposition. Do not deeply split the biggest JSON-shaped modules before the cutover.

### 13. Retire or shrink `FileThreadStore`

`FileThreadStore` currently handles too much:

- thread CRUD;
- actor/message/turn/chunk writes;
- root index reconciliation;
- threadId map;
- generated rollout identity migration;
- legacy rollout retirement;
- file locking;
- fixture creation;
- atomic file helpers.

After SQLite cutover, it should become legacy/migration support or disappear from the active path.

### 14. Split async maintenance around jobs and artifact commits

Current hotspots:

- `src/thread/async-thread/services/async-thread-run-service.ts`
- `src/thread/async-thread/services/smooth-turn-service.ts`
- `src/thread/async-thread/services/lower-band-compression-service.ts`
- `src/thread/async-thread/services/user-prompt-smoothing-service.ts`

After SQLite, organize this around:

- job claiming;
- artifact generation;
- artifact commit;
- retry/stale handling;
- status/event recording.

### 15. Extract shared band allocation/readiness policy

Selection/readiness logic appears in:

- `src/thread/async-thread/services/async-thread-run-service.ts`
- `src/thread-view/services/thread-view-builder.ts`
- `src/commands/smart-compact.ts`
- `src/workbench/services/workbench-query-service.ts`

Centralize it after the storage cutover, when SQL-backed queries and artifact readiness are clear.

Target output: an explainable projection/readiness plan consumed by async maintenance, smart compact, thread-view rendering, and workbench reports.

### 16. Split the PI extension monolith

`src/context-steward/pi/pi-extension.ts` owns too much:

- event capture;
- active session reconciliation;
- prompt-visible tool-result trimming;
- background maintenance scheduling;
- command registration;
- smart compact session switching;
- timing/status reporting.

After SQLite clarifies capture/maintenance boundaries, split it into adapter/coordinator modules:

- event capture adapter;
- active session coordinator;
- prompt projection/trimming coordinator;
- background maintenance scheduler;
- command registration/handlers;
- smart compact command handler;
- PI notifications.

### 17. Clean naming and compatibility paths

Declare durable names:

- **Context Steward** = product/system name;
- `thread` = canonical source domain;
- `thread-view` = projection/view IR;
- `workbench` = inspection/query/reporting;
- `pi` integration = runtime adapter.

Then quarantine old compatibility imports:

- `src/context-steward/domain/*` → `src/thread/domain/*`
- `src/context-steward/services/*` → `src/thread/services/*`
- `src/context-workbench/*` → `src/workbench` / `src/thread-view`

Add a guard against new internal imports from deprecated shims.

---

## P4 — Product polish and cleanup

### 18. Make `packages/lh-context` consume typed SQLite/read models

The package is valuable, but should not grow around raw internal file shapes.

After SQLite cutover:

- expose stable read models;
- validate persisted records;
- reduce `any` in package inspection code;
- expose a stable package/extension entrypoint;
- document publish/build flow.

### 19. Quarantine placeholder-era generation

`src/thread/async-thread/services/placeholder-artifact-service.ts` appears to be legacy scaffolding.

Action:

- move placeholder generation to legacy/test support;
- keep read compatibility only if needed;
- prevent normal production paths from creating placeholder lower-band artifacts.

### 20. Improve operational visibility

SQLite should make this easier.

Status/reporting should expose:

- canonical token growth;
- prompt-visible token growth;
- live-truncated tool-result count;
- truncation policy/head-tail settings;
- generated compact token count;
- requested vs actual band distribution;
- token provenance/trust class;
- maintenance job status and failures.

A per-thread event log can live in SQLite rather than ad hoc debug files.

### 21. Clean root/runtime hygiene

Observed noise/risk:

- tracked `.thread-snapshots/*` files;
- runtime/session artifacts near source;
- `.beads` modified during work;
- package `.pi/` untracked during package work;
- older docs that may not represent current state.

Recommendations:

- decide whether `.thread-snapshots` is fixture data or local runtime data;
- ignore local runtime data;
- keep current-state docs separate from historical epics;
- add root `engines` if package/runtime requires a specific Node version.

---

# Major technical debt buckets

## 1. Persistence model is the central constraint

The current JSON/file-backed model makes continuous maintenance harder than it needs to be.

The system intentionally does expensive preparation during normal operation so smart compact can be fast. That means message-end/turn-end processing must safely coordinate:

- canonical capture;
- live tool-result trimming;
- derived artifact generation;
- token counting;
- maintenance scheduling;
- readiness/projection state.

SQLite directly addresses this with transactions, indexed reads, and durable job/artifact records.

## 2. Concurrency risk is in async derived maintenance, not rollout replacement

The main conflict area is not multiple PI agents sharing one rollout file.

The conflict area is one active session/process doing overlapping background work against the same canonical thread:

- capture advances canonical state;
- smoothing/chunking/lower-band work finishes later;
- derived commits must not overwrite newer state;
- prompt-visible trimming must not replace canonical raw tool result content.

Canonical capture should be strict. Derived artifacts should be transactional, retryable, and allowed to lag.

## 3. Large files are large partly because storage responsibilities leak upward

Largest production files observed:

```text
2625  src/context-steward/pi/pi-extension.ts
2255  src/thread/async-thread/services/async-thread-run-service.ts
2146  src/thread/store/file-thread-store.ts
1244  src/thread-view/services/thread-view-builder.ts
980   src/workbench/services/workbench-query-service.ts
969   src/thread/async-thread/services/smooth-turn-service.ts
941   src/thread/async-thread/services/lower-band-compression-service.ts
```

Do not deeply refactor these around the current JSON store. SQLite should change their responsibilities.

## 4. Policy duplication remains a major maintainability risk

The system has several consumers that need to answer:

- Which turns/chunks will be selected?
- Which artifacts are required?
- Which token counts are trusted?
- Which missing states are blockers vs degraded warnings?
- Which lower-band chunks are eligible?

Centralize this after SQLite makes artifact readiness and queries cleaner.

## 5. Historical naming drift taxes future agents

The domain language evolved:

- Context Steward → thread;
- Context Workbench → workbench/thread-view;
- placeholder lower-band → semantic lower-band;
- projection/thread-view/generated rollout terms overlap.

Create current-state docs and then enforce canonical import paths.

## 6. Package/SDK boundary is promising but not stable yet

`@pi-long-horizon/context` is valuable for read-only inspection and other-directory usage. It should eventually consume stable read models from SQLite-backed state rather than raw JSON/file shapes.

---

# Anti-shim rules for the migration

1. SQLite is canonical for new/active threads after cutover.
2. JSON is migration/import support, not a permanent second backend.
3. Avoid long-term dual-write.
4. Every compatibility path needs a deletion condition.
5. Each migration story should retire or reduce old code, not only add adapters.
6. Do not build a generic storage framework for imaginary backends.
7. Keep the PI rollout file as generated/replaced projection unless the PI integration model changes.

---

# Suggested story breakdown

## Story 1 — SQLite architecture and migration design

Deliverables:

- per-thread SQLite schema;
- transaction boundary design;
- message-end ordering spec;
- maintenance job/event model;
- JSON-to-SQLite migration design;
- rollout file boundary documented.

## Story 2 — SQLite thread store core

Deliverables:

- create/load per-thread DB;
- canonical message capture;
- turn storage;
- derived artifact storage;
- token count storage;
- maintenance job/event storage;
- core tests.

## Story 3 — JSON migration utility

Deliverables:

- explicit migration CLI/helper;
- validation of current JSON thread files;
- import into SQLite;
- count/hash verification;
- fixture migration support.

## Story 4 — Runtime cutover

Deliverables:

- active runtime uses SQLite for new/active threads;
- message-end capture/trimming ordering fixed;
- async maintenance commits to SQLite;
- smart compact reads from SQLite and regenerates rollout;
- service tests pass on SQLite path.

## Story 5 — Delete/quarantine old path and refactor around SQLite

Deliverables:

- JSON write path removed or moved to legacy/import;
- `FileThreadStore` retired from active path;
- async maintenance split around jobs/artifacts;
- PI extension split around clarified runtime boundaries;
- package/workbench reads moved toward stable SQLite-backed read models.

---

# What not to do first

- Do not deeply refactor `FileThreadStore` before SQLite.
- Do not patch/append smart compact rollout files.
- Do not make rollout files canonical.
- Do not keep JSON and SQLite as equal long-term backends.
- Do not do broad style-only cleanup before the persistence migration.
- Do not remove live tool-result trimming; clarify its ordering and source-of-truth boundary.

Overall: SQLite should be the main architectural refactor. It directly addresses the real concurrency/persistence pressure created by continuous derived-text maintenance, and it will make later decomposition of the large files more meaningful.
