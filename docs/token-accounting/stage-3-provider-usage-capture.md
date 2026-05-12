# Stage 3 Provider Usage Capture

Date: 2026-05-12

## Scope

Stage 3 persists provider usage telemetry from PI assistant messages when the upstream message includes `usage`. This is capture-only work: provider usage telemetry is retained as reported by PI/OpenAI, but it is not used as message size, Thread View allocation input, smart compact budget evidence, or a materialized count.

Stage 3's changed-file slice is limited to provider usage capture, the token telemetry type surface, focused provider usage tests, token count metadata tests, and this documentation. Existing dirty Thread View materialized-count and smart-compact drift remains from Stage 1 triage work and is intentionally not changed or reverted here.

## Added Canonical Surface

`MessageRecord` now has optional `tokenTelemetry`.

For PI assistant messages with provider usage, `tokenTelemetry.providerUsage` stores:

- `source: "pi_assistant_message_usage"`
- provider, API, model, response id, response model, and stop reason provenance
- the structured provider `usage` object exactly as captured, including input, output, cache, total, and cost fields when PI supplies them
- `capturedAt`, using the assistant message timestamp when available
- an optional `provider_usage_telemetry` `TokenCountRecord` when `usage.totalTokens` is present as a nonnegative integer

The `TokenCountRecord` is explicitly scoped as `provider_usage_telemetry`, sourced from `provider_usage`, and trusted as `provider_reported`.

Provider usage keeps this record only at `tokenTelemetry.providerUsage.tokenCountRecord`; Stage 3 does not duplicate provider token counts in a top-level telemetry records array.

## Mapping Behavior

`mapPiMessageEnd` now attaches telemetry only for PI assistant messages. User prompts, tool results, runtime events, and unknown message roles do not receive placeholder or fake usage metadata.

The mapper preserves the full usage object even if only some fields are present. If `totalTokens` is absent or invalid, the raw provider usage telemetry is still retained, but no `TokenCountRecord` is created.

## Serialization

No store migration was needed. Messages are already persisted as JSONL `MessageRecord` objects, so the optional `tokenTelemetry` field roundtrips through the existing file store and fixture snapshot paths.

## Intentionally Not Wired

This stage does not:

- use provider usage telemetry as raw message materialized size
- change smart compact allocation, band selection, or budget decisions
- replace legacy `tokenCount` mirrors
- calculate materialized token counts for raw messages, turns, Thread Views, chunks, or generated sessions
- backfill provider usage telemetry into old persisted messages

Provider usage telemetry answers "what did the provider report for this assistant call?" Materialized counts remain a separate accounting surface for "how many tokens will this representation consume when loaded into a Thread View or generated session?"
