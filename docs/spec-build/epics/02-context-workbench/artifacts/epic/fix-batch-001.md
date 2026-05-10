# Epic Fix Batch 001

## Findings Addressed

### cw-epic-002: Activation bypasses canonical thread-store mutation queue

- APPROVED: Route `FileThreadViewStore.activateThreadView` thread metadata update through `threadStore.updateThreadMetadata` instead of directly rewriting `thread.json`. The activation method should call the canonical ThreadStore API to update `activeThreadViewId` and `updatedAt`, coordinating through `FileThreadStore.globalThreadQueues` to prevent stale-write clobber from concurrent imports, appends, repairs, or other metadata updates. The activation should still hold its own `threadMutationQueues` lock for view-state transitions, but delegate the thread.json write to the canonical store.

### cw-epic-003: Missing Context Workbench integration and E2E test suites

- APPROVED: Create `tests/context-workbench/file-thread-view-store.integration.test.ts` with the 4 integration tests specified in test-plan.md: Thread Views survive process-style reopen, activation updates active-view invariant atomically, workbench query reads mixed Thread + Thread View state, search remains practical over large realistic thread data.
- APPROVED: Create `tests/context-workbench/context-workbench.e2e.test.ts` with the 9 E2E tests specified in test-plan.md: opens Thread with active Thread View, creates empty draft, fills upper bands and materializes, compares draft and active views, activates draft and archives prior active, rejects activation when emitted output required but missing, opens fixture Thread through workbench flow, reports lower-band blocker for open or incomplete chunk, source Thread unchanged after view edits and activation.

## Findings Deferred

### cw-epic-001: Lower-band read and composition paths are test-shimmed

This finding is deferred as accepted-risk. Story 5 scope explicitly states "deliberately shallow" lower-band awareness — the full chunk-maintenance control plane and production chunk reader are Feature 3 scope. The EMPTY_CHUNK_READER fallback and pass-through composition are the specified design for Feature 2: the workbench reads chunk state produced elsewhere and makes it understandable, without deciding chunk boundaries or generating summaries. The test-only InMemoryChunkReader is appropriate for Feature 2 verification because the real chunk reader depends on Feature 3 infrastructure.
