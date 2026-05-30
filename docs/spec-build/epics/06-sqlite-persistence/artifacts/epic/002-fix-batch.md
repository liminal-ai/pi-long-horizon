# Epic 6 Fix Batch — Round 2

Source: Epic fix round 1 `needs-more-fix` — `npm run verify-all` fails in long-thread E2E.

## Fix

- **Prepare-mode compact must regenerate lower-band artifacts after chunk transcript catch-up**: The round-1 chunk lower-band downgrade fix correctly invalidates detailed/brief lower-band artifacts when the conversation transcript becomes stale. However, the prepare-mode smart compact catch-up path must then regenerate those downgraded lower-band artifacts before projecting the rollout. The E2E test at `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts:928` expects "Detailed semantic lower-band memory" or "Brief semantic lower-band memory" in the generated rollout. After the round-1 fix, the lower-band artifacts are downgraded to `pending` but the prepare catch-up does not regenerate them, so compact omits them. Ensure that prepare-mode maintenance catch-up includes lower-band chunk artifact regeneration after transcript catch-up so that `npm run verify-all` passes with the round-1 fix in place. The targeted tests for both round-1 fixes (`sqlite-maintenance-row-level.test.ts`, `runtime-capture-sqlite.test.ts`) already pass, so the regression is only in the prepare→compact→lower-band pipeline.
