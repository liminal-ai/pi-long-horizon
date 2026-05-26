# Epic 6 Tech Design: SQLite Persistence

## 1. Purpose And Context

PI Long Horizon currently keeps managed thread state in `.context-steward/threads/<threadId>/` as JSON and JSONL files. That file-backed store made early dogfooding inspectable and easy to recover manually, but it has become the wrong active persistence substrate for long-running PI sessions.

The core pressure is not that JSON cannot represent the data. The pressure is mutation granularity. Runtime capture, turn lifecycle updates, async smoothing, exact token repair, chunk repair, lower-band repair, projection metadata updates, and smart compact all touch related state. Today several of those operations read a full thread snapshot, perform work, and then rewrite whole JSON files such as `turns.json` or `chunks.json` under expected-revision checks. Recent failures around `repairOpenAITokenCounts` and `writeTurnsFailed` exposed the recurring failure class: a derived/background writer computes against one snapshot while source/lifecycle writes advance the thread, then the derived write loses the stale-revision race and must recover.

This design moves the managed per-thread source artifact to SQLite while preserving PI's JSONL rollout/session file as a generated runtime projection.

```text
.context-steward/threads/<threadId>/thread.sqlite
  managed canonical + derived source of truth

.context-steward/threads/<threadId>/generated/*.jsonl
  PI-facing rollout/session projection; disposable and regenerable
```

The central invariant remains:

> Canonical managed thread state is authoritative. Derived artifacts are repairable. Generated PI rollout JSONL is not source truth.

This document is paired with `test-plan.md`. The tech design defines architecture, interfaces, mutation/provenance semantics, and work chunks; the test plan owns complete TC-to-test mapping, architecture-risk tests, mock boundaries, and verification gates.

## 2. Spec Validation

The epic is designable, but several requirements need concrete implementation interpretation before stories are published.

### 2.1 Validation checklist

| Check | Result | Notes |
|---|---|---|
| Every AC maps to implementation work | Pass | Mapped to store, migration, runtime, maintenance, compact, inspection, and compatibility modules below. |
| Data contracts are realistic | Pass with clarification | The epic names domain entities; this design makes SQL table families and store interfaces concrete. |
| Edge cases have TCs | Pass | Restart/reopen, migration repeatability, missing rollout, attach/import, and maintenance debt are represented. |
| Technical constraints missed by epic | Clarified | SQLite dependency/runtime choice, project-level discovery cache, and legacy file-store quarantine are design decisions. |
| Flow sequence is implementable | Pass with staged cutover | Runtime, maintenance, compact, and `lhx` cut over in separate chunks to avoid split-brain writes. |

### 2.2 Issues, clarifications, and deviations

| Issue | Spec Location | Resolution | Status |
|---|---|---|---|
| Thread-local DB vs project DB | Assumption A1 | Use one `thread.sqlite` per managed thread for portability, snapshots, and migration isolation. | Resolved — clarified |
| Project-level session lookup | AC-1.1, AC-2.1, AC-3.5 | SQLite stores authoritative thread/session linkage; project JSON index may remain as non-authoritative discovery cache during transition. | Resolved — clarified |
| Generated rollout JSONL ownership | AC-1.9, Flow 5 | Generated JSONL remains outside SQLite; SQLite stores metadata/current binding and can regenerate output. | Resolved — clarified |
| Legacy file store | Scope / compatibility | File store remains for import/export/fixtures/backcompat, but active runtime source writes move to SQLite after cutover. | Resolved — clarified |
| Full schema in epic | Entity coverage flow | Epic correctly avoids table schema; this design defines SQL table families and interfaces. | Resolved — clarified |
| Dependency choice | Tech Design Question | Recommend `better-sqlite3@^12.10.0` plus internal migrator based on current npm metadata and Node 24 fit; alternatives documented. | Resolved — design decision |

## 3. Current Architecture Review

### 3.1 Current file layout

Current managed threads use this shape:

```text
.context-steward/
  index.json
  threadId-map.json
  threads/<threadId>/
    thread.json
    actors.json
    messages.jsonl
    turns.json
    chunks.json
    imports.json
    projections.json
    generated/*.jsonl
    archives/pi-thread-views/*
```

Important roles:

| File | Current role | Source/derived/projection class |
|---|---|---|
| `thread.json` | thread identity, source revision, target/session metadata, readiness/status, current projection metadata | mixed canonical + derived metadata |
| `actors.json` | actor identity/type/source mapping | canonical support data |
| `messages.jsonl` | append-only captured message source truth | canonical source |
| `turns.json` | prompt-bounded turns, smooth artifacts, lower-band turn projections, raw/smooth token metadata, repair state | mixed canonical grouping + derived artifacts |
| `chunks.json` | grouped closed turns, smooth chunk text, lower-band detailed/brief artifacts, chunk token metadata | derived managed state |
| `imports.json` | attach/import history and issues | managed audit/source metadata |
| `projections.json` | projection revision records and generated rollout linkage | projection metadata |
| `generated/*.jsonl` | PI-facing generated rollout/session files | generated projection output |
| `index.json`, `threadId-map.json` | project-level discovery/session-to-thread mapping | discovery/index metadata |

### 3.2 Current store and mutation behavior

The active store interface is `src/thread/store/thread-store.ts`. The file implementation is `src/thread/store/file-thread-store.ts`.

Key active write methods:

| Store method | Current file effects | Contention surface |
|---|---|---|
| `appendMessage` | appends `messages.jsonl`, updates `thread.json`, may update `actors.json` | source revision, message high watermark, target event index |
| `writeTurns` | rewrites whole `turns.json`, updates `thread.json.turnsRevision/status.turnState` | stale source/message/turns revision conflicts |
| `writeChunks` | rewrites whole `chunks.json`, updates `thread.json.updatedAt` | stale source/message/turns revision conflicts |
| `updateThreadMetadata` | rewrites `thread.json`, may update target/session mappings | source revision conflicts and discovery drift |
| `writeProjectionRevision` | rewrites `projections.json`, updates `thread.json.threadViewOutputSummary`, updates `threadId-map.json` | projection/current rollout metadata conflicts |
| `recordImport` | rewrites `imports.json`, updates `thread.json.importSummary` | source/metadata conflicts |

`FileThreadStore` serializes per-thread mutations with an in-process queue and a lease file under `.thread-mutation-locks`, but expected revision checks still reject writes computed from stale snapshots. This is correct for source protection but expensive for derived repair because a failed write often rewrites an entire in-memory `turns` or `chunks` array.

### 3.3 Runtime capture paths

The PI extension lives at `src/context-steward/pi/pi-extension.ts`.

Relevant event paths:

- `message_end` maps finalized PI messages and calls `captureEvent(...)` / `captureFinalizedActivity(...)`.
- `captureFinalizedActivity` appends canonical messages through `store.appendMessage(...)`, then applies turn updates through `writeCapturedMessageTurns(...)`.
- User prompt smoothing may be scheduled after user `message_end`.
- Live prompt-visible tool-result truncation observes message_end data but preserves full canonical tool results.
- `turn_end` calls `finalizeOpenTurnOnTurnEnd(...)`, refreshes active prompt projection, waits `LH_TURN_END_MAINTENANCE_DELAY_MS` defaulting to 1000ms, then schedules bounded background maintenance.
- Background maintenance coalesces per thread and calls `maintainAsyncThread(...)`.

This path has two important semantics to preserve:

1. Canonical message capture must win over derived maintenance.
2. Turn lifecycle can become repair-needed without losing canonical messages.

### 3.4 Async maintenance and repair paths

`src/thread/async-thread/services/async-thread-run-service.ts` owns prepare/readiness and background maintenance.

Important functions:

- `maintainAsyncThread(...)`: bounded background cleanup.
- `prepareAsyncThread(...)`: strict/readiness or full prepare catch-up before compact.
- `repairMissingArtifacts(...)`: repairs smooth turns, lower-band turn projections, chunk state, and selected lower-band chunks.
- `repairOpenAITokenCounts(...)`: repairs exact token metadata for raw/smooth turns and chunk/lower-band artifacts.
- `persistTokenCountingMaintenanceStatus(...)`: updates thread-level tokenCounting readiness.

Current bounded background defaults are:

```ts
maxSmoothTurns: 2
maxProjectionTurns: 2
maxTokenTurns: 2
maxTokenChunks: 2
```

Manual/full repair is in `src/thread/async-thread/services/thread-maintenance-repair-service.ts`, especially `repairThreadMaintenance(...)`, and intentionally runs broader catch-up than turn-end background maintenance.

The current problem class is visible in `repairOpenAITokenCounts(...)`: it loads a full snapshot, mutates cloned turns/chunks in memory, and calls `writeTurns(...)` / `writeChunks(...)` with expected revisions. SQLite should turn these into narrow row updates keyed by affected turn/chunk/artifact/token rows.

### 3.5 Smart compact and projection paths

`src/commands/smart-compact.ts` coordinates compact:

1. opens a thread snapshot;
2. acquires a mutation lease;
3. calls `prepareAsyncThread(...)` in strict or prepare mode;
4. calls `buildThreadViewProjection(...)`;
5. builds a PI thread-view JSONL file;
6. applies prompt-visible tool-result truncation to the generated PI file;
7. exact-counts final generated session;
8. writes generated JSONL through PI writer;
9. records projection/generated-output metadata through `updateGeneratedThreadViewOutputMetadata(...)`.

Thread-view building lives in `src/thread-view/services/thread-view-builder.ts`. PI JSONL writing lives in `src/thread-view/targets/pi/pi-thread-view-writer.ts`.

Important behavior to preserve:

- Smart compact reads canonical managed state, not the previous generated rollout as source.
- Band percentages are allocation weights, not exact output guarantees.
- Full canonical tool results remain in managed source; prompt-visible truncation can apply to generated rollout entries.
- Projection metadata is managed state; generated JSONL content is output.

### 3.6 Inspection/reporting paths

`packages/lh-context` is a separate SDK+CLI package. Current read-only inspectors load file-backed `.context-steward` data directly via `packages/lh-context/src/core/io.ts` and compose:

- `inspectSummary(...)`
- `inspectTokens(...)`
- `inspectBands(...)`
- `inspectPostCompactReport(...)`

This package should migrate to a store/query adapter rather than continue reading JSON files directly once SQLite is active. During transition it can support both legacy file-backed and SQLite-backed thread roots.

## 4. Target System View

### 4.1 Ownership diagram

```text
PI runtime events
  └─ Context Steward PI adapter
       └─ ThreadStore API
            └─ SqliteThreadStore
                 └─ thread.sqlite  <-- managed source truth

Async maintenance / manual repair
  └─ ThreadStore API
       └─ targeted canonical/derived row updates

Smart compact
  └─ read SQLite snapshot
       └─ build Thread View projection
            └─ write generated PI JSONL file
            └─ record projection metadata in SQLite

lhx / SDK inspection
  └─ read SQLite query model
       └─ report canonical, derived, readiness, projection metadata
```

### 4.2 Source boundary rules

1. `thread.sqlite` is authoritative for managed thread data.
2. PI rollout JSONL is the active PI-facing continuation surface and may be appended/edited by PI.
3. If SQLite and generated rollout metadata disagree, SQLite wins.
4. Generated rollout JSONL can be regenerated from SQLite.
5. Legacy JSON files are read only for import/export/fixtures after cutover.
6. Canonical messages and parts are never truncated in SQLite; prompt-visible truncation is projection-only.

## 5. Store And Module Architecture

### 5.1 Top-tier surfaces

| Surface | Source | This epic's role |
|---|---|---|
| Thread Store / Persistence | Existing repo surface, locally named | Moves managed canonical and derived state from file-backed JSON/JSONL to SQLite. |
| Runtime PI Adapter | Existing `src/context-steward/pi` surface | Continues to translate PI lifecycle events into managed store operations. |
| Async Maintenance / Repair | Existing `src/thread/async-thread` surface | Replaces whole-file derived writes with targeted SQLite updates while preserving bounded/full repair split. |
| Projection / Smart Compact | Existing `src/thread-view` and `src/commands/smart-compact.ts` surfaces | Reads SQLite snapshots and writes generated PI JSONL rollout files. |
| Inspection SDK/CLI | Existing `packages/lh-context` surface | Reads SQLite-backed state through a loader/query adapter while preserving read-only CLI behavior. |
| Migration / Snapshot / Compatibility | New cross-cutting surface | Imports legacy file-backed threads, exports/snapshots SQLite threads, and quarantines active JSON writes. |

### 5.2 Module responsibility matrix

| Module/surface | Status | Responsibility | Dependencies | ACs covered |
|---|---|---|---|---|
| `src/thread/store/thread-store.ts` | modify | Evolve from file-oriented whole-array API to canonical/derived query + transaction API. Keep compatibility methods during transition. | domain records, errors | AC-1.1–1.10, AC-3.1–3.5, AC-4.1–4.6 |
| `src/thread/store/sqlite-thread-store.ts` | new | SQLite-backed `ThreadStore` implementation. Owns DB open, migrations, transactions, row mapping. | `better-sqlite3`, migrations | AC-1.1–1.10, AC-3.1–3.5, AC-4.1–4.6 |
| `src/thread/store/migrations/*.sql` | new | SQL schema migrations and schema version registry. | SQLite | AC-1.1–1.10, AC-2.1–2.5 |
| `src/thread/store/file-thread-store.ts` | keep/legacy | Legacy import/export/fixture store; not active post-cutover source writes. | filesystem | AC-2.1–2.5, AC-7.3–7.5 |
| `src/thread/migration/sqlite-thread-migration-service.ts` | new | Import legacy thread directories into `thread.sqlite`; produce validation reports. | file store, SQLite store | AC-2.1–2.5 |
| `src/thread/services/*` | modify | Route capture/import/turn lifecycle through store transaction helpers. | ThreadStore | AC-3.1–3.6 |
| `src/thread/async-thread/services/*` | modify | Replace whole-array derived writes with narrow store operations where possible. | ThreadStore, providers/counters | AC-4.1–4.6 |
| `src/thread-view/services/thread-view-builder.ts` | modify | Read compact snapshots from store/query API. | ThreadStore snapshot/query model | AC-5.1–5.5 |
| `src/thread-view/targets/pi/*` | mostly keep | Continue writing generated PI JSONL files. | filesystem, PI JSONL shape | AC-5.1, AC-5.4, AC-7.1 |
| `src/context-steward/pi/pi-extension.ts` | modify | Create SQLite store for active managed threads; preserve lifecycle behavior and background scheduling. | ThreadStore, PI runtime | AC-3.1–3.6, AC-4.1 |
| `packages/lh-context/src/core/*` | modify later | Read through file-or-SQLite loader/query API. | loader/query API | AC-6.1–6.5 |
| snapshot/export service | new/modify | Package `thread.sqlite` plus generated rollout artifacts and manifest. | SQLite store, filesystem | AC-7.1–7.5 |

### 5.3 Compatibility direction

The first implementation slice should support importing existing file-backed threads and inspecting SQLite-backed state before runtime cutover. Runtime cutover must account for the actual code shape: the PI extension and command paths share one `createStore` factory. Capture, maintenance, commands, and compact do not have independently swappable store factories today.

Therefore the runtime cutover is a **whole-store compatibility cutover**, not separate capture/maintenance/compact cutovers. Story 2 changes the shared factory to return `SqliteThreadStore` for active managed threads, and `SqliteThreadStore` must implement the existing `ThreadStore` compatibility API well enough for capture, maintenance, commands, and compact to keep functioning. Later stories narrow high-contention writes and retire compatibility methods.

Compatibility policy:

| Caller | During migration | Story 2 compatibility cutover | Later adaptation |
|---|---|---|---|
| PI extension capture | file store | SQLite through existing `ThreadStore` API | direct canonical transaction helpers where useful |
| async maintenance | file store | SQLite through existing `openThread` / `writeTurns` / `writeChunks` compatibility API | row-level derived artifact/token/chunk updates |
| smart compact | file store | SQLite through existing read/projection compatibility API | compact snapshot helper and regeneration hardening |
| commands | file store | SQLite through shared `createStore` | command-specific query helpers as needed |
| `lhx` | file-backed direct reads | file + SQLite loader support later | SQLite-first query adapter with graceful driver handling |
| fixtures | file fixtures remain valid | migration fixtures plus SQLite fixtures | legacy fixture import/export only |
| generated JSONL | unchanged | unchanged | unchanged |

Surface ownership rules:

| Surface/Name | Canonical Owner | Compatibility Facade | Allowed Direction | Forbidden Direction | Verification |
|---|---|---|---|---|---|
| Managed thread source | `SqliteThreadStore` after cutover | `FileThreadStore` import/export adapter | legacy file -> SQLite import | SQLite runtime -> legacy active source write | `legacy-compat-sqlite.test.ts` |
| Generated rollout | PI JSONL writer | projection metadata in SQLite | SQLite snapshot -> generated JSONL | generated JSONL -> canonical overwrite | `rollout-regeneration-sqlite.test.ts` |
| Inspection | loader/query API | file-backed loader during transition | `lhx` -> loader -> store/query | `lhx` direct mutation | `lhx-sqlite-inspection.test.ts` |
| Session/thread lookup | SQLite target/session linkage | project discovery index | discovery index -> SQLite resolution | discovery JSON as sole authority | `runtime-reopen-sqlite.test.ts` |

### 5.4 Whole-array compatibility strategy

The current `ThreadStore` API includes whole-array methods such as `writeTurns(input)` and `writeChunks(input)`. Existing callers commonly clone the full snapshot, mutate a small subset, and write the whole array back. That shape cannot be removed at the same time the shared store factory is cut over without turning Story 1 into a multi-service rewrite.

This design chooses **Option C**:

1. `SqliteThreadStore` implements existing `writeTurns` and `writeChunks` compatibility methods for Story 2.
2. Those compatibility methods run inside SQLite transactions and diff incoming records against current rows by stable IDs, updating only changed rows where practical.
3. `SqliteThreadStore` also exposes narrower row-level methods such as `upsertDerivedArtifact`, `upsertTokenCount`, and chunk/turn membership updates.
4. Stories 2 and 3 migrate high-contention maintenance/compact callers from whole-array compatibility methods to row-level methods.
5. Story 6 removes, guards, or quarantines whole-array compatibility use from active runtime paths.

This lets the shared `createStore` cutover happen once while still preserving the architectural goal: derived repair should eventually update affected rows, not rewritten thread-sized arrays.

## 6. Interface Definitions

These signatures define the implementation contracts that later story skeletons should create. Names may be adjusted to match existing repo conventions, but the result/error shape and boundary responsibilities should remain stable.

Important compatibility rule: `SqliteThreadStore` must implement the **full existing `ThreadStore` interface** during the whole-store cutover, not only the new methods shown below. The existing compatibility surface includes thread creation/opening, actor operations, message reads/appends, turn/chunk reads and writes, metadata updates, import records, projection revisions, thread/session lookup, mutation assertions, and fixture open/create support. The excerpt below highlights the compatibility methods that are architectural seams plus the new targeted methods added by this design; it is not a replacement for the source interface in `src/thread/store/thread-store.ts`.

Existing compatibility groups:

| Group | Representative existing methods | Why required during Story 2 |
|---|---|---|
| Thread lifecycle | `createThread`, `openThread`, `updateThreadMetadata` | new thread creation, capture, maintenance status, compact metadata |
| Actors/messages | `upsertActor`, `listActors`, `appendMessage`, `readMessages` | capture and repair/token-count inputs |
| Turns/chunks | `readTurns`, `writeTurns`, `readChunks`, `writeChunks` | existing maintenance and compact callers before row-level adaptation |
| Import/attach | `recordImport` | post-cutover attach/import behavior |
| Projection metadata | `readProjectionRevisions`, `writeProjectionRevision` | smart compact and rollout metadata |
| Session/thread lookup | `resolveThreadIdMap`, `recordThreadIdMap`, `findThreadByTarget`, `findManagedThread` | PI startup/reopen/session resolution |
| Mutation/fixtures | `assertCanMutate`, `createFixture`, `openFixture` | smart compact leases and existing fixture services |

```ts
export interface ThreadStoreFactory {
  open(input: OpenThreadStoreInput): Promise<StewardResult<ThreadStore>>;
  create(input: CreateThreadStoreInput): Promise<StewardResult<ThreadStore>>;
}

export interface OpenThreadStoreInput {
  rootDir: string;
  threadId?: string;
  threadDir?: string;
  mode: "file_legacy" | "sqlite" | "auto";
}

export interface ThreadStore {
  openThread(threadId: string): Promise<StewardResult<ThreadSnapshot>>;
  readChunks(threadId: string): Promise<StewardResult<ChunkState[]>>;

  // Compatibility methods required for shared createStore cutover.
  writeTurns(input: WriteTurnsInput): Promise<StewardResult<TurnRecord[]>>;
  writeChunks(input: WriteChunksInput): Promise<StewardResult<ChunkState[]>>;

  // Newer targeted methods used by adaptation stories.
  transact<T>(input: ThreadTransactionInput<T>): Promise<StewardResult<T>>;
  appendCanonicalMessage(input: AppendCanonicalMessageInput): Promise<StewardResult<CaptureWriteResult>>;
  upsertTurnLifecycle(input: UpsertTurnLifecycleInput): Promise<StewardResult<TurnLifecycleResult>>;
  listMaintenanceDebt(input: ListMaintenanceDebtInput): Promise<StewardResult<MaintenanceDebtRecord[]>>;
  upsertDerivedArtifact(input: UpsertDerivedArtifactInput): Promise<StewardResult<DerivedArtifactWriteResult>>;
  upsertTokenCount(input: UpsertTokenCountInput): Promise<StewardResult<TokenCountWriteResult>>;
  readCompactSnapshot(input: ReadCompactSnapshotInput): Promise<StewardResult<CompactThreadSnapshot>>;
  recordProjectionRun(input: RecordProjectionRunInput): Promise<StewardResult<ProjectionRunRecord>>;
}

export interface ImportFileBackedThreadInput {
  rootDir: string;
  threadId: string;
  sourceThreadDir?: string;
  targetDbPath?: string;
  mode: "validate_only" | "import";
}

export interface ImportFileBackedThreadResult {
  threadId: string;
  dbPath: string;
  importedCounts: Record<string, number>;
  skippedCounts: Record<string, number>;
  warnings: StewardIssue[];
  blockers: StewardIssue[];
  generatedRolloutPath?: string;
  readinessSummary: ThreadReadinessSummary;
}

export async function importFileBackedThread(
  input: ImportFileBackedThreadInput,
): Promise<StewardResult<ImportFileBackedThreadResult>>;

export interface BuildThreadViewFromStoreInput {
  store: ThreadStore;
  threadId: string;
  requestedLowerBound: number;
  bandWeights: ThreadViewBandPercentages;
  mode: "strict" | "prepare";
}

export interface ReadCompactSnapshotInput {
  threadId: string;
  sourceRevision?: number;
  requiredLowerBandArtifacts?: ChunkSemanticArtifactBand[];
}

export interface CompactThreadSnapshot {
  thread: ThreadRecord;
  actors: ActorRecord[];
  messages: MessageRecord[];
  turns: TurnRecord[];
  chunks: ChunkState[];
  projectionRevisions: ProjectionRevisionRecord[];
  tokenCounts: TokenCountRecord[];
  readinessIssues: StewardIssue[];
  readRevision: number;
}
```

`readCompactSnapshot(...)` exists to replace the current two-call compact read pattern (`openThread(...)` then `readChunks(...)`). For SQLite it must read all compact inputs inside one read transaction so messages, turns, chunks, artifacts, token counts, readiness issues, and projection metadata come from the same DB snapshot. For the file-store compatibility implementation it may delegate to existing reads, but Story 4 should move smart compact to the SQLite-consistent snapshot contract.

```ts

export interface InspectManagedThreadInput {
  rootDir?: string;
  threadId?: string;
  threadDir?: string;
  threadViewPath?: string;
  backing?: "auto" | "file" | "sqlite";
}
```

Structured service functions should return `StewardResult<T>` or existing command result shapes rather than throwing for expected domain failures. Throwing remains appropriate only for programmer errors or process-fatal failures.

## 7. SQLite Data Model

This section defines table families, not final SQL migration text. The implementation should use strict tables, foreign keys, indexes for common query paths, and JSON columns only where the data is genuinely target/provider-specific.

### 7.1 Core canonical tables

| Table | Purpose | Notes |
|---|---|---|
| `schema_migrations` | internal migration runner state | `version`, `name`, `applied_at`, checksum optional |
| `threads` | thread identity/lifecycle/source revision | one row per DB; stores project/root/target status summaries |
| `thread_targets` | active and historical runtime/session/file linkage | supports PI session → thread resolution and generated rollout mappings |
| `actors` | actor identity/type/target metadata | stable actor IDs for duplicate detection/audit |
| `messages` | canonical ordered messages | append-only logical source; unique target event keys where present |
| `message_parts` | ordered message parts | full content preserved; content stored as text/json payload plus kind |
| `imports` | attach/import audit records | preserves partial/failure issues |

Canonical uniqueness:

- `messages.source_order` unique per thread.
- `messages.source_revision` records the revision that introduced the message.
- target event keys are unique per thread where available.
- `message_parts(message_id, part_order)` unique.

### 7.2 Turn and membership tables

| Table | Purpose |
|---|---|
| `turns` | prompt-bounded turn identity/lifecycle/source span/repair status |
| `turn_messages` | ordered membership from turns to canonical messages |
| `turn_smooth_artifacts` | smooth text/materialized smooth state/provenance |
| `turn_smooth_components` | optional component-level smooth provenance |
| `turn_lower_band_projections` | per-turn lower-band projection text/provenance/token metadata |

Turn lifecycle is partly canonical grouping and partly repairable derived state. Canonical messages remain source truth if turn lifecycle fails. A failed turn update must leave messages present and mark or allow reconstruction of turn repair-needed state.

### 7.3 Chunk and lower-band tables

| Table | Purpose |
|---|---|
| `chunks` | grouped closed-turn chunk lifecycle/source revision/smooth text |
| `chunk_turns` | ordered source turn membership |
| `chunk_conversation_transcripts` | conversation-only transcript artifact where available |
| `chunk_lower_band_artifacts` | detailed/brief semantic artifacts with provider provenance |

Legacy placeholder chunks should import as either artifact rows with `artifact_kind='legacy_placeholder'` or as repair-needed skipped records according to migration validation policy.

### 7.4 Token and readiness tables

| Table | Purpose |
|---|---|
| `token_counts` | token metadata for messages, turns, artifacts, chunks, bands, generated sessions |
| `readiness_issues` | blocker/warning/degraded/repair-needed issues by scope/entity |
| `maintenance_runs` | background/manual/prepare run summaries |
| `maintenance_debt` | optional per-entity dirty/debt records for bounded repair selection |

`token_counts` should support:

- entity type/id;
- scope (`raw_turn_materialized`, `smooth_turn_materialized`, `detailed_chunk_materialized`, etc.);
- count/source/trust class;
- provider/model/tokenizer;
- representation hash;
- source revision;
- created timestamp/provenance.

This may duplicate some fields currently embedded in turn/chunk JSON, but it gives exact token repair a narrow update target.

### 7.5 Projection tables

| Table | Purpose |
|---|---|
| `projection_revisions` | generated thread-view/projection metadata |
| `projection_band_entries` | optional normalized band membership/selected source references |
| `generated_outputs` | current generated rollout file metadata, token count, status/issues |

Generated JSONL content stays on disk. SQLite stores enough metadata to inspect, validate, and regenerate or relink rollout files.

## 8. Transaction And Mutation Semantics

### 8.1 General SQLite settings

- Use WAL mode.
- Enable foreign keys.
- Set a busy timeout.
- Keep provider/model calls outside DB transactions.
- Use `BEGIN IMMEDIATE` for write transactions that must serialize with other writers.
- Treat SQLite busy/locked as retryable according to store policy.

### 8.2 Source transactions

Canonical capture transaction writes together:

1. actor upsert if needed;
2. message row;
3. message part rows;
4. target event key index;
5. thread source revision/message high watermark;
6. turn lifecycle update if it can be applied safely.

If turn lifecycle update cannot complete, the message remains committed and turn repair-needed state is persisted or reconstructable. This preserves source truth before derived grouping.

### 8.3 Derived transactions

Derived maintenance should:

1. read candidate rows and source inputs;
2. do provider/token computation outside transaction;
3. start a write transaction;
4. revalidate source revision, representation hash, and current artifact dependency;
5. upsert the affected artifact/token/readiness rows;
6. commit or mark debt retryable.

Derived repair must not roll back or corrupt canonical messages.

### 8.4 Projection read and write transaction semantics

Smart compact has two consistency boundaries:

1. **Build-phase read consistency.** The projection builder currently makes separate store calls for thread snapshot and chunk state. With SQLite, smart compact should use `readCompactSnapshot(...)` or an equivalent read transaction that loads the thread, turns, messages, chunks, artifacts, and projection metadata from one SQLite snapshot. WAL mode allows this without blocking normal readers, and it avoids accidental mixed-revision projection inputs.
2. **Output write consistency.** Smart compact writes generated JSONL to a temporary path first, then records projection metadata/current binding after final token count succeeds. If file write succeeds but metadata write fails, recovery should be able to detect an unreferenced generated file. If metadata write succeeds but reload fails, projection status should record degraded/failed output state without changing canonical source.

If implementation temporarily keeps separate `openThread` and `readChunks` calls during Story 2 compatibility cutover, the story must document the accepted window: newly appended messages between the reads are not eligible for chunk/lower-band selection until later maintenance, and strict compact must still report readiness from the snapshot it actually used. Story 4 should remove that ambiguity by routing compact through `readCompactSnapshot(...)`.

### 8.5 Fixture contracts

SQLite implementation stories must use fixtures that reflect actual current and target persistence shapes.

- Legacy file-backed fixtures include all relevant current files: `thread.json`, `actors.json`, `messages.jsonl`, `turns.json`, `chunks.json`, `imports.json`, `projections.json`, and generated rollout JSONL when the behavior involves projection metadata.
- SQLite fixtures use real temp DB files, not in-memory mocks, when testing persistence/reopen/migration/snapshot behavior.
- Invalid fixtures are explicit and named by broken invariant, such as missing turn membership, conflicting actors, stale lower-band provenance, or missing generated rollout.
- Provider/token-counter behavior is faked at the provider boundary, not by mocking internal maintenance services.

### 8.6 Derived-state provenance

Every persisted derived artifact that can affect readiness or compact output needs enough provenance to decide whether it is ready, stale, or repair-needed.

| Derived state | Required provenance |
|---|---|
| Smooth turn artifact | source turn/message span, source revision, input/content hash, strategy/prompt version, provider/model metadata where available, token metadata, status |
| Turn lower-band projection | turn ID, band/projection kind, source smooth/raw dependency, source revision, prompt version, provider/model metadata, token metadata, stale/failure status |
| Chunk smooth state | chunk ID, ordered turn membership, source turn revisions, smooth text/hash, token metadata, readiness status |
| Detailed/brief chunk artifact | chunk ID, band kind, source chunk/smooth dependency, prompt version, provider/model/reasoning metadata, token metadata, status/failure |
| Token count | entity type/id, representation scope, count source, trust class, provider/model/encoding, representation hash, source revision, status |
| Projection run | source revision, selected band layout, generated file path, final generated token count, output status, issue list |

### 8.7 Deterministic algorithm boundaries

The implementation must define golden cases for deterministic decisions that affect compact/readiness results.

- Dirty/debt ordering for bounded maintenance: newest/recently affected first unless a story explicitly chooses oldest-first for catch-up.
- Background maintenance limits are inclusive caps; full/manual/prepare paths pass unbounded/full scope intentionally.
- Strict compact blocks on missing/stale/heuristic required counts; prepare may attempt repair first.
- Generated rollout token count is the final serialized/truncated output count, not the sum of source artifact rollups.
- Band weights are allocation preferences; whole-turn/chunk boundaries and readiness may cause actual output to diverge.
- Generated rollout mismatch never overwrites canonical SQLite state.

## 9. Runtime Flows

### 9.1 New thread / first capture

```text
message_end
  -> resolve no existing managed thread
  -> transaction: create thread + target linkage + required actors + first message/parts
  -> create/open turn state or mark repair-needed
  -> schedule bounded maintenance
```

### 9.2 Capture duplicate event

Target event keys remain idempotency keys. Duplicate finalized activity returns the existing canonical message and does not append a new source row.

### 9.3 Turn end

```text
turn_end
  -> resolve active thread from captured/session mapping
  -> transaction: close latest open turn if present
  -> refresh prompt-visible projection output if needed
  -> delayed/coalesced bounded background maintenance
```

The 1s file-store debounce is a compatibility mitigation. SQLite should not depend on timing for correctness, but coalescing remains useful to avoid unnecessary repair work.

### 9.4 Background maintenance

`maintainAsyncThread` remains bounded/incremental. It repairs a small set of newly dirty/recent rows and records remaining debt. Limits should remain configurable.

### 9.5 Manual repair / prepare

Manual repair and smart-compact prepare remain full catch-up paths. They can process all eligible dirty rows, still with limited provider concurrency and narrow transactions.

### 9.6 Smart compact

Smart compact reads a consistent SQLite snapshot, checks readiness, builds a Thread View projection, writes generated JSONL, exact-counts final output, records metadata, then PI reloads/switches to that rollout.

### 9.7 Restart/reopen

On restart, Long Horizon resolves the active PI session to the managed SQLite thread using canonical target/session linkage plus project-level discovery metadata. If generated rollout has appended live PI records after compact, reconciliation imports/captures those records into SQLite rather than treating older projection metadata as current canonical truth.

## 10. Migration Design

### 10.1 Import order

1. Create/open `thread.sqlite` and apply schema migrations.
2. Insert thread identity/status/source revision from `thread.json`.
3. Insert target/session mappings from `thread.json`, `index.json`, and `threadId-map.json`.
4. Insert actors.
5. Insert canonical messages and parts from `messages.jsonl`.
6. Insert turns and turn membership/artifacts/token metadata.
7. Insert chunks/chunk membership/lower-band artifacts/token metadata.
8. Insert imports and projection revisions.
9. Insert generated-output metadata/current rollout binding.
10. Validate counts/status and write migration report.

### 10.2 Idempotency

Use stable IDs and unique keys so repeat migration upserts the same records rather than duplicating. Migration should maintain a `migration_runs` or report artifact with source file fingerprints/counts.

### 10.3 Partial migration

An interrupted migration should either:

- leave the DB marked `migration_incomplete`, or
- roll back the current transaction batch and retry safely.

Do not mark a thread SQLite-ready until validation completes.

### 10.4 Validation report

Report fields:

- source thread ID;
- target DB path;
- source file list/fingerprints;
- imported counts by entity;
- skipped/rejected counts;
- warnings/blockers with entity IDs/ranges;
- generated rollout linkage;
- readiness summary;
- repeat/partial migration status.

## 11. Inspection, Snapshot, Export

`lhx` should gain a loader abstraction:

```ts
loadManagedThread(input) -> FileBackedLoadedThread | SqliteBackedLoadedThread
```

`packages/lh-context` currently has no native dependencies and is intended to remain a portable inspection SDK/CLI with no PI runtime dependency. SQLite support must not accidentally make the whole package brittle for users who only inspect legacy file-backed threads.

Decision for Story 5:

- keep file-backed inspection available with no SQLite driver requirement;
- add SQLite inspection through a dynamic/optional SQLite adapter;
- do **not** make `better-sqlite3` a hard dependency of `packages/lh-context` in Story 5;
- prefer `optionalDependencies` for `better-sqlite3` only if packaging smoke tests show optional native installation behaves reliably for linked/packed installs;
- otherwise keep the SQLite adapter as a dynamic import supplied by the parent/global Long Horizon package and return structured `SQLITE_DRIVER_UNAVAILABLE` guidance when unavailable;
- do not add PI runtime dependencies to the read-only `lhx` inspection path beyond the package's existing launcher/extension packaging needs.

Initial SQLite inspection should preserve current outputs for summary/tokens/bands/report and then expand to readiness/turn/chunk drilldowns.

Snapshot/export shape:

```text
snapshot/
  manifest.json
  thread.sqlite
  generated/<current-or-selected-rollouts>.jsonl
  debug-or-report-artifacts/
```

Legacy JSON export may remain available for debugging, but it must be labeled as export, not active source truth.

## 12. Dependency Decision

### 12.1 Recommendation

Use:

```text
better-sqlite3@^12.10.0
@types/better-sqlite3@^7.6.13
internal SQL migration runner
```

Rationale:

- The project targets Node 24 and currently uses TypeScript ESM with simple local filesystem persistence.
- `better-sqlite3` latest observed version is `12.10.0`; `npm view` reports engine support including Node `24.x`.
- Its synchronous API fits local embedded DB transactions and avoids promise-pool complexity.
- Provider/model calls remain outside transactions, so synchronous DB operations should stay short.
- An internal migrator is enough for a local per-thread DB: `schema_migrations(version, name, applied_at)` plus numbered SQL files.

### 12.2 Alternatives

| Alternative | Decision | Reason |
|---|---|---|
| `node:sqlite` | defer | Official Node docs show it as release-candidate in current docs, with synchronous APIs and improving options, but it is still newer than `better-sqlite3`. Revisit when stability/version target is clear. |
| Bun `bun:sqlite` | reject for this epic | Bun docs describe a fast native SQLite API, but this project is Node 24-based and should not introduce a Bun runtime requirement for persistence. |
| `sqlite` + `sqlite3` | reject for first slice | Async wrapper stack adds dependency/API complexity without clear benefit for local per-thread writes. |
| Kysely/Drizzle ORM | defer | Typed query builders may help later, but the first SQLite slice should keep schema and store functions explicit. |
| Prisma/TypeORM/Sequelize | reject | Too heavy for local embedded per-thread persistence. |

Sources checked during design: Node `node:sqlite` documentation (`https://nodejs.org/api/sqlite.html`), Bun SQLite documentation (`https://bun.com/docs/api/sqlite`), and current npm metadata for `better-sqlite3`, `@types/better-sqlite3`, Kysely, and Drizzle.

## 13. Error Contracts

New or preserved issue codes should include:

- `SQLITE_STORE_UNAVAILABLE`
- `SQLITE_DRIVER_UNAVAILABLE`
- `SQLITE_MIGRATION_FAILED`
- `SQLITE_SCHEMA_UNSUPPORTED`
- `MIGRATION_VALIDATION_FAILED`
- `THREAD_IDENTITY_CONFLICT`
- `CANONICAL_WRITE_FAILED`
- `DERIVED_WRITE_CONFLICT`
- `PROJECTION_REGENERATION_FAILED`
- `GENERATED_ROLLOUT_MISSING`
- existing `STALE_SOURCE_REVISION` where compatibility callers still use revision checks

Errors should remain structured `StewardIssue` records with thread/entity scope where possible.

## 14. Testing And Verification Strategy

Detailed TC mapping, architecture-risk tests, mock strategy, and chunk test counts live in `test-plan.md`. The high-level testing policy is:

- Use real temp SQLite DB files for persistence, migration, restart/reopen, snapshot/export, and generated-file tests.
- Use real temp directories for legacy file-backed migration fixtures and generated rollout JSONL.
- Mock or fake external provider/token-counter/lower-band services at their boundary.
- Do not mock internal store, maintenance, compact, or inspection modules in tests that claim integration confidence.
- Keep PI E2E tests few and targeted to adapter registration, runtime capture, and generated rollout reload.

Actual repo gates:

| Gate | Command | Use |
|---|---|---|
| Type/compile check | `npm run typecheck` where available | Red-exit / local sanity when behavior tests are intentionally red |
| Standard service gate | `npm run verify` | Primary repo health gate during implementation |
| PI E2E gate | `npm run test:e2e` | Runtime adapter/projection smoke and selected regressions |
| Deep gate | `npm run verify-all` | Pre-close or release-level confidence; run with sufficient timeout, currently 600s for long E2E |
| Package local gate | package-specific `typecheck`, `test`, `build` | Required when touching `packages/lh-context`; does not replace root health gate |

No implementation bead should be closed while `npm run verify` is red unless a known-red issue is explicitly tracked with evidence, owner, and blocking status.

### 14.1 Existing test-suite migration

The repo's current service tests frequently instantiate `FileThreadStore` directly or through helpers. After Story 2's whole-store runtime cutover, file-backed tests are no longer sufficient proof of the active production path.

Story 0 must introduce SQLite-aware test helpers, and Story 2 must classify existing tests into three groups:

1. **Store-conformance / production-path tests** — run against `SqliteThreadStore` through `createTestThreadStore({ backing: "sqlite" })` or a matrix helper.
2. **Legacy file-store regression tests** — intentionally remain file-backed to protect import/export/fixture behavior and should be labeled as such.
3. **Store-agnostic service tests** — should use a factory so the same service behavior can be tested against active SQLite without duplicating test bodies.

This classification prevents root verification from staying green only because most tests still exercise the retired active store.

### 14.2 Async interface over synchronous SQLite

`better-sqlite3` operations are synchronous internally, while the existing `ThreadStore` interface is Promise-based. The SQLite store should preserve the async interface so services do not change shape during Story 2. Tests should verify observable sequencing, not implementation mechanics:

- synchronous SQLite read;
- async provider/token-counter call yields the event loop;
- another service writes newer source state;
- stale derived commit revalidates source revision/input hash before updating rows.

This is the real concurrency interleaving for local Node execution. It is not a simultaneous multi-threaded write race.

## 15. Work Breakdown

The work breaks into vertical chunks. Each chunk has a semantic center and a test footprint in `test-plan.md`; stories should not use Chunk 0 as hidden design discovery or hide the all-at-once store swap.

### Story 0: SQLite Store Foundation

**Scope:** Add dependency, migration runner, schema v1, SQLite open/create helpers, DB lifecycle helpers, test helper adaptation, basic store conformance, and migration smoke. No full migration suite and no runtime cutover.

**ACs:** Foundation support for AC-1.1–1.10 and AC-2.1–2.5, but not full entity/migration acceptance.

**Relevant sections:** 3, 4, 5, 6, 7, 8, 12.

**Chunk risk shape:** Local persistence and test infrastructure foundation. Source authority is still legacy file store for runtime. Main risks are premature feature scope, weak fixture realism, helper divergence, and inability to run active-store tests later.

**Architecture-risk tests:** DB reopen, schema migration smoke, fixture/helper validity, whole-array compatibility smoke. See `test-plan.md` Chunk 0.

### Story 1: Full Migration And Entity Coverage

**Scope:** Complete file-backed thread import, entity preservation, derived artifact/token/readiness import, projection metadata import, validation report, idempotency, and interrupted retry. No runtime cutover yet.

**ACs:** AC-1.1–1.10, AC-2.1–2.5.

**Relevant sections:** 3, 4, 5, 7, 8.5, 8.6, 10, 13.

**Chunk risk shape:** Migration correctness. Source authority is still legacy file store for runtime, but SQLite import must prove it can preserve and classify all managed state before active use. Main risks are lossy import, silent merge/conflict, bad derived provenance, and projection metadata confusion.

**Architecture-risk tests:** full migration count preservation, idempotent repeat, interrupted retry, source-vs-projection import handling, derived provenance classification. See `test-plan.md` Chunk 1.

### Story 2: Whole-Store Runtime Compatibility Cutover

**Scope:** Route the shared `createStore` factory to `SqliteThreadStore` for active managed threads. `SqliteThreadStore` must implement the existing compatibility API (`openThread`, `readChunks`, `writeTurns`, `writeChunks`, projection metadata writes, etc.) so capture, maintenance, commands, and compact all operate against SQLite together. Generated rollout JSONL remains unchanged.

**ACs:** AC-3.1–3.6, plus compatibility smoke coverage for AC-4.1, AC-5.1, AC-6.1, and AC-7.1 through the existing API/read surfaces.

**Relevant sections:** 4, 5, 6, 8, 9, 13.

**Chunk risk shape:** Source-authority transition and shared-store swap. Canonical messages/parts/session linkage become SQLite writes, but existing maintenance/compact callers still use compatibility methods. Main risks are partial source writes, wrong session/thread resolution, duplicate capture, compatibility `writeTurns`/`writeChunks` semantics, and hidden split-brain reads.

**Architecture-risk tests:** rollback, runtime adapter proof, restart/reopen, capture while maintenance is active, compatibility `writeTurns`/`writeChunks` row-diff behavior, and smoke checks that inspection/snapshot surfaces do not crash against SQLite-backed state. See `test-plan.md` Chunk 2.

### Story 3: Derived Maintenance Row-Level Adaptation
**Scope:** Migrate smoothing, lower-band projections, chunk updates, exact token repair, readiness issues, and maintenance status away from whole-array compatibility writes toward targeted SQLite row updates.

**ACs:** AC-4.1–4.6.

**Relevant sections:** 5.4, 6, 7, 8, 9, 13, 14.

**Chunk risk shape:** Derived-state/provenance transition. Canonical source is already SQLite; derived state is repairable and must not clobber source. Main risks are stale provider results, missing provenance, unbounded background work, and debt disappearing instead of being visible.

**Architecture-risk tests:** lost update, derived provenance invalidation, bounded vs full repair distinction, retryable contention. See `test-plan.md` Chunk 3.

### Story 4: Smart Compact Snapshot And Rollout Regeneration Hardening
**Scope:** Move smart compact from compatibility reads to `readCompactSnapshot(...)`, write generated PI JSONL, exact-count final generated output, record projection metadata, and regenerate missing rollout files.

**ACs:** AC-5.1–5.5.

**Relevant sections:** 3.5, 4, 7.5, 8.4, 8.7, 9.6, 11.

**Chunk risk shape:** Source-to-projection bridge. SQLite is source truth; JSONL is output. Main risks are mixed-revision compact reads, treating previous rollout as source, metadata/file split failure, and confusing artifact rollups with final generated count.

**Architecture-risk tests:** compact read consistency, source-vs-projection truth, projection atomicity/recovery, strict/prepare deterministic boundaries. See `test-plan.md` Chunk 4.

### Story 5: Inspection, Reporting, Snapshot, And Export
**Scope:** Move `lhx` inspection/reporting to SQLite-backed query support and add snapshot/export format containing `thread.sqlite`, generated JSONL, and manifest.

**ACs:** AC-6.1–6.5, AC-7.1–7.4.

**Relevant sections:** 4, 5.3, 6, 10, 11, 14.

**Chunk risk shape:** Read-model and portability bridge. Main risks are mixing canonical, derived, projection, and generated-output counts; producing snapshots that look authoritative but are incomplete; and breaking legacy debug workflows.

**Architecture-risk tests:** missing rollout inspection, stable JSON output, snapshot restore, legacy export labels. See `test-plan.md` Chunk 5.

### Story 6: Legacy File-Store Retirement And Compatibility Cleanup
**Scope:** Quarantine active JSON writes, remove/guard direct JSON assumptions in runtime/maintenance/compact/inspection paths, and preserve explicit import/export/fixture support.

**ACs:** AC-7.3–7.5 and cross-cutting split-brain prevention.

**Relevant sections:** 5.3, 10, 11, 14.

**Chunk risk shape:** Compatibility retirement. Main risks are accidental split-brain writes, lingering direct file assumptions, and fixtures silently using the wrong active source owner.

**Architecture-risk tests:** no active runtime dual-write, direct JSON write guard/smoke, legacy fixture import still works. See `test-plan.md` Chunk 6.

## 16. Open Questions

| Question | Blocks |
|---|---|
| Should project-level `index.json` remain indefinitely as discovery cache, or be replaced by a project SQLite index later? | Story 2+; not Story 0 |
| Should `token_counts` be fully normalized immediately, or keep some artifact-local JSON metadata mirrored during transition? | Story 0 schema |
| Should maintenance debt use an explicit `maintenance_debt` table in v1, or derive debt from artifact/token/readiness rows? | Story 3 |
| How much legacy JSON export is required after SQLite cutover? | Story 5/6 |
| Do we need a dedicated `lhx migrate` command in Story 0, or an internal migration service first? | Story 0 |

## 17. Deferred Items

- Web workbench / database browser.
- Provider expansion beyond current OpenAI/Codex token-counting path.
- Arbitrary manual memory curation workflows.
- Semantic search / wiki integration.
- Public npm naming/publishing changes.
- Broad smart compact UX redesign.
