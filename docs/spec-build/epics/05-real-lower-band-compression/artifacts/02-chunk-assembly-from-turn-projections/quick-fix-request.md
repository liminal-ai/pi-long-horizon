# Quick-Fix: Story 2 Missing TC Proofs

## Context

Story 2 (Chunk Assembly From Turn Projections) has 7/12 TCs verified but 5 TCs remain unproven. The gates pass (462 tests, 0 failures) and the core chunk assembly logic works correctly. What's missing are specific contract tests and one production logic fix.

## Tasks

### Task 1: Add TC-2.4a, TC-2.4b, TC-2.5b contract tests to `tests/thread/chunk-service.test.ts`

These tests prove the conversation-only chunk transcript is the lower-band source, NOT smooth text:

- **TC-2.4a (shared source transcript):** Given a closed chunk with a ready `conversationTranscript`, assert that both detailed and brief generation would read from the same `conversationTranscript.text` field (not from smooth text). This is a data-contract test — prove the chunk exposes one transcript source for both bands.

- **TC-2.4b (brief not derived from detailed):** Assert that the chunk's lower-band source for brief generation is `chunk.conversationTranscript`, not `chunk.lowerBand.detailed.text`. Both bands read from the transcript independently.

- **TC-2.5b (lower-band source remains separate from smooth):** Assert that when a chunk has both `smoothText` and `conversationTranscript`, the field used as lower-band generation input is `conversationTranscript`, not `smoothText`. These are separate representations.

### Task 2: Make legacy blocking unconditional (TC-2.6b, TC-2.6c)

Currently in `src/thread/async-thread/domain/chunk-state.ts`, legacy placeholder chunks are only blocked AFTER at least one `conversation_only_chunk_v1` chunk exists (the `cutoverStarted` / `hasCutoverStarted` check). This means all-legacy threads still select old placeholder state as lower-band output.

**Fix:** Remove the `cutoverStarted` conditional from the lower-band selection paths. Legacy placeholder chunks should ALWAYS be blocked from lower-band selection, regardless of whether new-schema chunks exist yet. The affected selection paths are:
- `src/thread-view/services/thread-view-builder.ts` (strict lower-band selection)
- `src/thread/async-thread/services/async-thread-run-service.ts` (prepare readiness)

**Update tests:** The existing tests at:
- `tests/thread-view/thread-view-builder.test.ts` ("strict lower-band selection blocks legacy placeholder chunks after conversation-only cutover starts")
- `tests/thread/async-thread-run-service.test.ts` ("prepare readiness blocks legacy placeholder chunks once conversation-only cutover has started")

Should be updated to prove legacy blocking is unconditional — remove the setup that injects a new-schema chunk before asserting the block.

### Verification

After these changes, `npm run verify` must still pass. The expected test count should be ~465 (462 + 3 new contract tests).
