# Epic Fix Batch 002: EV-05-001 Strict Readiness ↔ Selection Convergence

## Finding

EV-05-001 confirmed: `prepareAsyncThread` strict readiness accepts chunks with ready semantic text, but strict `selectLowerBandChunkIds` in the builder can reject those same chunks when their `tokenCountMetadata` is missing, heuristic-only, or has a mismatched `sourceRevision`. Smart compact can report a thread as strict-ready while emitting no lower-band selections.

## Root Cause

The `resolveChunkSemanticArtifactAccounting` function in `thread-view-builder.ts:308-343` checks `isFreshTokenCountRecord(artifact.tokenCountMetadata, chunk.sourceRevision)` at line 321. If `sourceRevision` doesn't match or the persisted count was heuristic and strict policy rejects it, the function falls back to computing a new count at lines 334-342 — but that computed count may also be rejected under strict policy mode.

Meanwhile `prepareAsyncThread` readiness at `async-thread-run-service.ts:882-909` only checks for ready lower-band text, not for usable strict accounting.

## Fix Items

- In `src/thread/async-thread/services/async-thread-run-service.ts`, update strict prepare readiness to also verify that ready semantic lower-band artifacts have accounting that `resolveChunkSemanticArtifactAccounting` would accept under the active policy mode. If a chunk has ready text but no usable accounting under strict mode, it should block readiness with a specific error rather than passing through to selection where it will be silently dropped.

- In `src/thread/async-thread/services/lower-band-compression-service.ts`, ensure `buildSemanticArtifactTokenCountMetadata` sets `sourceRevision` matching the chunk's current `sourceRevision` on the persisted record, so `isFreshTokenCountRecord` accepts it.

- Update `tests/thread/async-thread-run-service.test.ts` to assert strict readiness blocks when a canonical semantic chunk has ready text but no usable strict-mode accounting.

- Update `tests/thread-view/thread-view-builder.test.ts` strict build test to assert that chunks with both ready text AND matching persisted exact counts produce non-empty lower-band selections under strict mode.
