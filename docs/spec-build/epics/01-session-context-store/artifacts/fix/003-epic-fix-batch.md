# Epic Fix Batch 2

Source: canonical epic review `artifacts/epic/003-epic-review.json`

## Approved Fixes

- APPROVED: CAN-001 — Stop `ensureActiveThread()` in `src/context-steward/pi/pi-extension.ts:563-617` from auto-creating managed threads on every lifecycle event (`session_start`, `session_before_switch`, `session_shutdown`, `turn_start`, `turn_end`, `message_end`). Only open existing managed threads on lifecycle events. New thread creation should only happen through explicit attach/import or when the first `message_end` event arrives for an unmanaged session with no prior history. This currently breaks Epic AC-5.1/AC-5.6 because pre-populated sessions get auto-managed before attach/import can preserve prior history.

- APPROVED: CAN-002 — Fix `/lh-attach` in `executeAttachCommand()` at `src/context-steward/pi/pi-extension.ts:304-320` to forward `activeLeafIdFromContext()` and `importSessionManagerFromContext()` through the attach command path, matching the pattern used by `executeFixtureCommand()` at `src/context-steward/pi/pi-extension.ts:449-457`. Also fix `attachExistingPiSession()` in `src/context-steward/services/import-service.ts:276-302` to use the import target's identity rather than binding to the current context target. Currently branched session imports fail with `IMPORT_PATH_AMBIGUOUS` through `/lh-attach` while succeeding through the fixture flow, and `/lh-attach <other-session-file>` creates a thread targeted at the current live session instead of the imported file.

- APPROVED: CAN-003 — Create `tests/context-steward/file-thread-store.integration.test.ts` with the 4 integration tests specified in the test plan at `docs/spec-build/epics/01-session-context-store/test-plan.md:221-235`: (1) managed Thread survives process-style reopen, (2) PI session fixture imports through file path, (3) concurrent capture requests serialize by source order, (4) stale temp metadata file does not replace the last committed snapshot. Also fix `scripts/run-node-tests.mjs:39-43` so an empty integration suite fails the gate instead of exiting 0.

## Not addressed in this batch

- CAN-004 (observation): Command-surface coverage gaps — non-blocking
- CAN-005 (observation): Synthetic sessionManager adapter — non-blocking
