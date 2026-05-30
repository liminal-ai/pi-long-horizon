# Story 2 Test Classification Evidence

This note records the Story 2 classification requested by `02-whole-store-runtime-compatibility-cutover.md` and `tech-design.md` section 14.1 after the SQLite runtime cutover quick-fix pass.

## 1. Production-path / store-conformance tests running against SQLite

- `tests/context-steward/runtime-capture-sqlite.test.ts`
- `tests/context-steward/runtime-reopen-sqlite.test.ts`
- `tests/context-steward/attach-import-sqlite.test.ts`
- `tests/context-steward/lhx-sqlite-smoke.test.ts`
- `tests/context-steward/snapshot-sqlite-smoke.test.ts`
- `tests/context-steward/pi-extension-sqlite.e2e.test.ts`
- `tests/thread/sqlite-thread-store-compat.test.ts`
- `tests/context-steward/e2e-cli.e2e.test.ts`
- `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts`

These are the Story 2 proof files for the active managed-thread source of truth after `createStore` defaults to `SqliteThreadStore`.

## 2. Intentional legacy file-store regression tests

- `tests/context-steward/file-thread-store.integration.test.ts`
- `tests/context-steward/fixture-service.test.ts`

These stay file-backed on purpose to protect explicit fixture/import/export compatibility while active runtime authority has moved to SQLite.

## 3. Store-agnostic service tests behind a factory or matrix

- No pre-existing broad service suite was fully matrixed during Story 2.
- Instead, Story 2 adds targeted SQLite production-path coverage for the previously missing reopen, attach/import duplicate detection, inspection smoke, and snapshot-export smoke behaviors.

This keeps the quick fix within Story 2 scope while making the active SQLite path authoritative in the gate-covered tests that matter for the cutover.
