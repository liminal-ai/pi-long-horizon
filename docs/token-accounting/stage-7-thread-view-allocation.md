# Stage 7 Thread View Band Allocation Switch

Date: 2026-05-12

## Scope

Stage 7 switches Thread View band allocation and compaction audit reporting to the token accounting records and source policy introduced in Stages 2 through 6. It does not add generated-session final validation, generated-session retry, provider network calls, or provider count APIs.

## Allocation Source

Thread View allocation now resolves scoped `TokenCountRecord` values before selecting turns or chunks:

- Full-fidelity uses `raw_turn_materialized` counts. Persisted raw turn records are accepted when fresh; otherwise the Stage 4 raw turn counter computes a build-time record.
- Smooth uses `smooth_turn_materialized` counts from smooth turn metadata when fresh; otherwise it recomputes from the smooth text.
- Detailed and brief lower bands use `detailed_chunk_materialized` and `brief_chunk_materialized` placeholder metadata when fresh; otherwise they recompute from placeholder text.

Provider usage telemetry is never offered to the materialized allocation resolver. It remains telemetry about the provider call, not evidence of Thread View materialized size.

## Source Policy

Selected records are evaluated through the Stage 5 counter source policy. Stage 7 uses prepare-mode policy evaluation for allocation because the currently available local Stage 4 and Stage 6 records are PI heuristic records. Those decisions carry degraded policy status and reason for audit visibility.

Future exact provider input counts or local tokenizer records can be selected by the same resolver without changing band allocation code.

## Newest Turn Behavior

Upper-band selection remains indivisible. The newest eligible turn is selected even when it exceeds its band budget. If the final selected materialized count exceeds the requested lower bound, the build reports `LOWER_THRESHOLD_UNREACHED` and returns a degraded result rather than treating the overage as successful.

## Audit Reporting

Compaction audit reporting now uses the same accounting resolver functions as allocation. Band totals, selected turn counts, and selected chunk counts are based on selected materialized accounting records rather than independently recounting emitted messages. Reports also expose policy status/reason fields where useful.

## Tests

Stage 7 updates Thread View builder, smart compact, and workbench report tests to use materialized counts. The full-fidelity tool-heavy regression verifies that a dense tool-result payload is counted through raw turn materialized accounting and does not cause over-selection from an undercounted payload.
