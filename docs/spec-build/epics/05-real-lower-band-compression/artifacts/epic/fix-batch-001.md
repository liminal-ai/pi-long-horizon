# Epic Fix Batch 001: EV-05-001 Strict Semantic Accounting

## Finding

EV-05-001: Strict lower-band readiness diverges from strict semantic accounting — chunks can report ready with semantic text but no exact detailed/brief token counts, causing strict projection selection to omit lower-band selections.

## Fix Items

- Wire exact token counting for ready detailed/brief semantic artifacts into the async maintenance path (`src/thread/async-thread/services/async-thread-run-service.ts`) so that when semantic lower-band artifacts are ready, their `tokenCountMetadata` is computed and persisted alongside the text.

- Update `src/thread/async-thread/services/lower-band-compression-service.ts` to persist `tokenCountMetadata` on ready semantic artifacts at write time, not just rely on deferred maintenance.

- Update `src/thread-view/services/thread-view-builder.ts` `resolveChunkSemanticArtifactAccounting` to use the persisted exact counts when available instead of falling back to heuristic records.

- Update `tests/thread/async-thread-run-service.test.ts` to assert that canonical semantic chunks with ready text also have `tokenCountMetadata` after maintenance runs.

- Update `tests/thread-view/thread-view-builder.test.ts` strict build test to assert that strict mode selects lower-band chunks when semantic artifacts have exact counts, rather than returning empty selections.
