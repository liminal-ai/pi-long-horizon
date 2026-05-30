# Epic 6 Fix Batch — Round 1

Source: `artifacts/epic/001-epic-review.json` canonical review findings.

## Fixes

- **Stale chunk lower-band readiness propagation**: When a source turn projection goes stale and chunk transcript is invalidated, downstream detailed/brief lower-band artifacts on that chunk must also be downgraded (not left as `ready`). Update `updateChunkState` or the chunk readiness evaluation path so that when `conversationTranscript.status` is downgraded to `pending`/`stale`/`invalid`, dependent `lowerBand.detailed` and `lowerBand.brief` artifacts are also downgraded. Add a regression test in `sqlite-maintenance-row-level.test.ts` proving that stale turn projection → chunk transcript invalidation → chunk lower-band downgrade propagates correctly.

- **First managed capture atomicity (TC-3.1c)**: The first managed capture path creates the thread and session linkage before the first canonical append succeeds, leaving a discoverable but empty managed thread on first-append failure. Wrap the first-capture path so that thread creation, session linkage, and the first canonical message append either all succeed together or all roll back. If full transactional wrapping is impractical, at minimum ensure the empty managed thread is not discoverable by `findManagedThread` until the first canonical message is committed. Add a regression test in `runtime-capture-sqlite.test.ts` proving that a failed first append does not leave a discoverable empty managed thread.
