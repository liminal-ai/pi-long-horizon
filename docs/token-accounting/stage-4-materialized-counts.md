# Stage 4 Materialized Representation Counts

Date: 2026-05-12

## Scope

Stage 4 adds a neutral materialized representation counter under `src/token-accounting/`. It does not switch smart compact allocation, band selection, chunk thresholds, placeholder generation, or provider telemetry policy.

The service answers: "what representation did we count, what stable hash identifies it, and what temporary local counter produced the number?"

Stage 4's changed-file slice is intentionally narrow:

- `src/token-accounting/materialized-representation-counter.ts`
- focused token-accounting tests under `tests/token-accounting/`
- the pure PI writer helper export needed to serialize generated-session content once
- this documentation

Existing dirty changes outside that slice are not Stage 4 accounting behavior. In particular, smart compact command changes, Thread View builder/materializer behavior changes, chunk threshold or token-estimator wiring, and PI writer generated-session compatibility behavior that predated this stage remain separate work. Stage 4 documents and counts the current materialized surfaces without endorsing, expanding, reverting, or relying on those behavior changes.

## Added Service Surface

`src/token-accounting/materialized-representation-counter.ts` exports:

- `createMaterializedRepresentationHash`
- `serializeMaterializedRepresentation`
- `countRawMessageMaterialized`
- `countRawTurnMaterialized`
- `countSmoothTurnMaterialized`
- `countDetailedChunkMaterialized`
- `countBriefChunkMaterialized`
- `countBandMaterialized`
- `countGeneratedSession`

Each count returns a `TokenCountRecord` with:

- `representationHash`
- `sourceRevision` when the counted source has one
- `provenance`
- `source: "pi_heuristic"`
- `trustClass: "heuristic_estimate"`

This is intentionally a temporary local counter source. Stage 5 can replace or refine source policy without changing the representation identity contract.

## Representation Invariants

Raw message counts use the same raw Thread View content helper that `ThreadViewMaterializer` uses for full-fidelity messages:

- message id
- actor id/type
- message kind
- capture timestamp
- structured parts
- PI target metadata

Raw turn counts are a rollup of ordered raw message materialized counts. The count is the sum of the raw message records; the hash covers the ordered raw message materialized content array.

Smooth turn, detailed chunk, and brief chunk counts hash/count the exact string content that materialized Thread View messages carry for those surfaces.

Band counts hash/count the ordered materialized `ThreadViewMessageRecord` array using the existing Thread View message ordering helper.

Generated session counts hash/count the JSONL string produced by the PI writer's exported `serializePiThreadViewFileContent` helper. `writePiThreadViewFile` uses the same helper, so tests can verify count/write parity without duplicating writer serialization.

The Stage 4 writer change is intended only as a pure helper seam: generated-session counting imports the same serializer used by the writer. Other PI writer behavior currently visible in the dirty tree, including model/thinking settings, hidden custom messages for compacted content, stricter tool-call ID serialization, and generated-session compatibility tests, was already identified in Stage 1 triage as adjacent generated-session compatibility work. It is not part of the Stage 4 accounting change unless a later compatibility stage adopts it deliberately.

The measured generated-session shape includes the writer's current tool-result encoding, where non-string structured content without user-visible parts is serialized into a text block via `JSON.stringify`. That JSON-stringified content shape is current measured writer output only. It is not canonical, not endorsed as the target PI format, and should be treated as a later generated-session compatibility fix path if PI compatibility work changes tool-result content modeling.

## Parity Tests

Focused tests cover:

- raw tool-result message content hashing against the materializer helper
- raw turn rollup invariants
- smooth/detailed/brief scoped records
- ordered band materialized records
- generated session JSONL hashing against the same content the PI writer writes, including tool-result `toolCallId`, `toolName`, and content block shape

## Not Yet Wired

Stage 4 does not:

- persist these new records onto Thread View, chunk, turn, or generated-session records
- replace existing bare `tokenCount` mirrors
- change Thread View builder selection decisions
- change smart compact threshold checks
- change smart compact allocation, band selection, or chunk thresholds
- change `pi-token-estimator.ts` wiring
- use provider usage telemetry as materialized size
- introduce provider input-count policy

The pre-existing dirty `pi-token-estimator.ts` wiring remains outside this Stage 4 service and should be treated as prior attempt code until a later stage decides whether to migrate or remove it.
