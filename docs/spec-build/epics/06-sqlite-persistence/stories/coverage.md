# Epic 6 Story Coverage: SQLite Persistence

## Coverage Gate

Stories only. No business epic was produced.

| Story | Primary Governing Idea | Primary AC Ownership |
|---|---|---|
| 00 SQLite Store Foundation | Establish SQLite/store/test rails before behavior work | No primary epic AC ownership; foundation criteria only |
| 01 Full Migration And Entity Coverage | Preserve all managed file-backed state in SQLite before active use | AC-1.1–1.10, AC-2.1–2.5 |
| 02 Whole-Store Runtime Compatibility Cutover | Shared `createStore` returns SQLite while existing `ThreadStore` compatibility keeps all consumers working | AC-3.1–3.6 |
| 03 Derived Maintenance Row-Level Adaptation | Derived repair updates affected SQLite rows without corrupting canonical source or hiding debt | AC-4.1–4.6 |
| 04 Smart Compact Snapshot And Rollout Regeneration | Compact reads consistent SQLite snapshots and writes regenerable PI rollout JSONL | AC-5.1–5.5 |
| 05 Inspection, Reporting, Snapshot, And Export | Operators can inspect and export SQLite-backed state without confusing source, derived, and projection artifacts | AC-6.1–6.5, AC-7.1–7.2 |
| 06 Legacy File-Store Retirement | Active source writes no longer split between legacy JSON and SQLite; fallback/legacy support is explicit | AC-7.3–7.5 |

### AC Coverage

| AC | Story |
|---|---|
| AC-1.1 | 01 |
| AC-1.2 | 01 |
| AC-1.3 | 01 |
| AC-1.4 | 01 |
| AC-1.5 | 01 |
| AC-1.6 | 01 |
| AC-1.7 | 01 |
| AC-1.8 | 01 |
| AC-1.9 | 01 |
| AC-1.10 | 01 |
| AC-2.1 | 01 |
| AC-2.2 | 01 |
| AC-2.3 | 01 |
| AC-2.4 | 01 |
| AC-2.5 | 01 |
| AC-3.1 | 02 |
| AC-3.2 | 02 |
| AC-3.3 | 02 |
| AC-3.4 | 02 |
| AC-3.5 | 02 |
| AC-3.6 | 02 |
| AC-4.1 | 03 |
| AC-4.2 | 03 |
| AC-4.3 | 03 |
| AC-4.4 | 03 |
| AC-4.5 | 03 |
| AC-4.6 | 03 |
| AC-5.1 | 04 |
| AC-5.2 | 04 |
| AC-5.3 | 04 |
| AC-5.4 | 04 |
| AC-5.5 | 04 |
| AC-6.1 | 05 |
| AC-6.2 | 05 |
| AC-6.3 | 05 |
| AC-6.4 | 05 |
| AC-6.5 | 05 |
| AC-7.1 | 05 |
| AC-7.2 | 05 |
| AC-7.3 | 06 |
| AC-7.4 | 06 |
| AC-7.5 | 06 |

## Integration Path Trace

| Path Segment | Description | Owning Story | Relevant TC / Criterion |
|---|---|---|---|
| Foundation store opens | SQLite DB lifecycle, migrations, and test helpers exist before behavior work | 00 | FC-0.1, FC-0.2 |
| Migration preserves identity | File-backed thread identity/session linkage imports into SQLite | 01 | TC-1.1a, TC-1.1c, TC-2.1c |
| Migration preserves canonical source | Messages, parts, actors, and full tool results import without loss | 01 | TC-1.2a, TC-1.3a, TC-1.3b, TC-2.1a, TC-2.1b |
| Migration preserves derived state | Turns, chunks, artifacts, token metadata, readiness, and projection metadata import or downgrade explicitly | 01 | TC-1.4a, TC-1.5a, TC-1.6a, TC-1.7a, TC-1.8a, TC-1.9a, TC-1.10a, TC-2.2a, TC-2.3a |
| Migration reports invalid state | Missing/stale/conflicting records become warnings, blockers, skipped, stale, or repair-needed state | 01 | TC-1.2c, TC-1.4b, TC-1.7b, TC-1.8b, TC-1.9b, TC-2.2b, TC-2.5a, TC-2.5b |
| Migration repeatability | Repeated or interrupted migration does not duplicate or hide partial state | 01 | TC-2.4a, TC-2.4b |
| Runtime first capture | Shared store factory writes first managed runtime activity into SQLite | 02 | TC-3.1a, TC-3.1c |
| Runtime idempotency | Duplicate finalized PI activity does not duplicate canonical source | 02 | TC-3.1b |
| Turn lifecycle fallback | Capture remains canonical when turn lifecycle cannot complete | 02 | TC-3.2a, TC-3.2b |
| Capture/maintenance coexistence smoke | SQLite-backed maintenance/compact/inspection/snapshot surfaces do not crash immediately after store swap | 02 | SC-2.1, SC-2.2, SC-2.3, SC-2.4 |
| Restart/reopen | SQLite-backed state restores active managed thread and reconciles generated rollout linkage | 02 | TC-3.5a, TC-3.5b, TC-3.5c, TC-3.5d |
| Attach/import after cutover | Unmanaged PI sessions attach/import into SQLite after cutover | 02 | TC-3.6a, TC-3.6b |
| Bounded background repair | Background maintenance repairs bounded affected rows and leaves visible debt | 03 | TC-4.1a, TC-4.1b, TC-4.3a, TC-4.3b |
| Manual/full repair | Manual repair performs full catch-up and reports provider/token failures without unintended rollout generation | 03 | TC-4.2a, TC-4.2b |
| Token trust repair | Exact token repair persists provider/trust metadata and leaves partial debt visible | 03 | TC-4.4a, TC-4.4b |
| Artifact invalidation | Smooth/lower-band changes invalidate dependent chunk/artifact readiness correctly | 03 | TC-4.5a, TC-4.5b |
| Maintenance reporting | Background vs manual maintenance status and per-entity debt are inspectable | 03 | TC-4.6a, TC-4.6b, TC-4.6c |
| Compact source read | Smart compact selects from managed SQLite state, not previous rollout | 04 | TC-5.1a, TC-5.1b |
| Strict/prepare compact boundary | Strict respects blockers; prepare performs full eligible catch-up | 04 | TC-5.2a, TC-5.2b, TC-5.3a, TC-5.3b |
| Rollout regeneration | Missing/archive rollout can be regenerated and projection metadata records output | 04 | TC-5.4a, TC-5.4b |
| Projection-only truncation | Prompt-visible tool truncation does not mutate canonical content and reports canonical/generated scale separately | 04 | TC-5.5a, TC-5.5b |
| Summary/tokens/bands/report inspection | SQLite-backed inspection reports source, derived, generated, status, warnings, and mismatches | 05 | TC-6.1a, TC-6.2a, TC-6.2b, TC-6.3a, TC-6.4a, TC-6.5a |
| Snapshot/export portability | Snapshot/export includes database, generated rollout where present, manifest, and ownership labels | 05 | TC-7.1a, TC-7.2a, TC-7.2b |
| Legacy compatibility | File-backed fixtures remain supported explicitly during transition | 06 | TC-7.3a |
| Source-truth retirement | Active writes no longer split between JSON and SQLite after cutover | 06 | TC-7.4a |
| Fallback clarity | Failed migration/cutover exposes active source-truth backing and required action | 06 | TC-7.5a |

## Story Shape Review

### Story 00: SQLite Store Foundation

- **Archetype:** Foundation.
- **Governing idea:** Build SQLite/store/test rails without changing runtime behavior.
- **Overload flags:** None. No primary epic AC ownership keeps this story small.
- **Notes:** Foundation criteria are design-derived, not epic AC/TC ownership.

### Story 01: Full Migration And Entity Coverage

- **Archetype:** Migration/entity coverage.
- **Governing idea:** Prove existing managed state can move into SQLite completely and repeatably.
- **Overload flags:** Large AC surface, but coherent because all ACs are entity preservation and migration validation.
- **Notes:** Runtime remains file-backed until Story 02.

### Story 02: Whole-Store Runtime Compatibility Cutover

- **Archetype:** Adapter/source-authority transition.
- **Governing idea:** One shared store factory switches to SQLite while compatibility methods preserve existing consumers.
- **Overload flags:** Broad surface due to shared `createStore`; kept together because the code cannot cut over capture, maintenance, compact, and commands independently.
- **Notes:** Maintenance/compact/inspection get smoke coverage only; primary behavior adaptation happens later.

### Story 03: Derived Maintenance Row-Level Adaptation

- **Archetype:** Derived-state repair/recovery.
- **Governing idea:** Derived maintenance becomes granular, retryable row updates while canonical source remains authoritative.
- **Overload flags:** Provider/token/artifact/chunk concerns share one derived-repair lifecycle and should stay together.

### Story 04: Smart Compact Snapshot And Rollout Regeneration

- **Archetype:** Projection/generation.
- **Governing idea:** Compact uses consistent SQLite snapshots and produces disposable PI rollout JSONL.
- **Overload flags:** Includes regeneration and truncation because both are projection-output behavior.

### Story 05: Inspection, Reporting, Snapshot, And Export

- **Archetype:** Read model / portability.
- **Governing idea:** Operators can inspect and carry SQLite-backed state without losing source/derived/projection boundaries.
- **Overload flags:** Combines reporting and snapshot/export because both are read-only portability surfaces.

### Story 06: Legacy File-Store Retirement

- **Archetype:** Compatibility retirement.
- **Governing idea:** Active source truth is no longer split; legacy file support remains explicit.
- **Overload flags:** Cross-cutting cleanup, but focused on one authority boundary.

## Future / Deferred Boundaries

- Web workbench and visual DB browser remain out of scope.
- New provider/model support remains out of scope.
- Broad smart compact UX/progress redesign remains out of scope.
- LLM wiki/KB work remains out of scope.
- Arbitrary manual memory curation remains out of scope.
- Public npm naming/publishing decisions remain out of scope.
- Tech design open questions remain deferred to their named stories, including whether `token_counts` is fully normalized immediately, whether project-level discovery remains JSON or later moves to a project SQLite index, and whether a dedicated `lhx migrate` command is needed beyond the internal migration service.

## Coverage Check

- ACs covered exactly once as primary story ownership: 42/42.
- Story 0 has no primary epic AC ownership by design.
- Story 2 includes smoke coverage for shared-store consumers but owns only AC-3.1–3.6 as primary behavior.
- Story 6 owns AC-7.3–7.5 to avoid duplicated compatibility/retirement ownership.
