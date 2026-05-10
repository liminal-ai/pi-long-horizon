# Epic Fix Batch 1

## Source
Compiled from canonical epic review artifact: `artifacts/epic/003-epic-review.json`

## Fixes

### Fix 1: CAN-001 — Lifecycle events auto-manage pre-populated sessions before attach/import
- **Finding:** `ensureActiveThread()` in `pi-extension.ts` calls `openOrCreateManagedThread()` on every lifecycle event, preventing attach/import from preserving prior history on those targets.
- **Fix:** Change `ensureActiveThread()` so it only opens existing managed threads on lifecycle events, not creates new ones. New thread creation should only happen through explicit attach/import or when the first `message_end` event arrives for an unmanaged session with no prior history.
- **Scope:** `src/context-steward/pi/pi-extension.ts` lifecycle handlers, related tests in `capture-service.test.ts`.

### Fix 2: CAN-002 — `/lh-attach` drops live branch context
- **Finding:** `executeAttachCommand()` doesn't forward `activeLeafId` or `importSessionManager` context, unlike `executeFixtureCommand()`, so branched session imports fail or bind to the wrong target.
- **Fix:** Forward `activeLeafIdFromContext()` and `importSessionManagerFromContext()` through the attach command path, matching the fixture command's pattern.
- **Scope:** `src/context-steward/pi/pi-extension.ts` attach command, `src/context-steward/services/import-service.ts`.

### Fix 3: CAN-003 — `verify-all` passes without planned integration suite
- **Finding:** Test plan requires `file-thread-store.integration.test.ts` but it doesn't exist. The test runner prints "No integration tests found" and exits 0, making the epic gate vacuous.
- **Fix:** Create `tests/context-steward/file-thread-store.integration.test.ts` with the 4 integration tests specified in the test plan: managed thread survives reopen, PI session fixture imports through file path, concurrent capture serializes by source order, stale temp metadata doesn't replace last committed snapshot.
- **Scope:** New file `tests/context-steward/file-thread-store.integration.test.ts`, verify `scripts/run-node-tests.mjs` handles integration test discovery.

## Out of scope
- CAN-004 (observation): Command-surface coverage gaps — non-blocking, can be addressed later.
- CAN-005 (observation): Synthetic sessionManager adapter — non-blocking, observational.
