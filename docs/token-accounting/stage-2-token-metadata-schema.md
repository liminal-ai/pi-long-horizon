# Stage 2 Token Metadata Schema

Date: 2026-05-12

## Scope

Stage 2 adds a neutral token accounting domain surface under `src/token-accounting/`. It defines canonical metadata for token counts without changing smart compact allocation, Thread View rebuilding, placeholder generation, or provider capture.

## Added Domain Surface

`src/token-accounting/token-count-metadata.ts` now defines:

- `TokenCountRecord`, the shared metadata envelope.
- Named canonical record types for raw message materialized count, raw turn materialized count, smooth turn materialized count, detailed chunk materialized count, brief chunk materialized count, band materialized count, generated session count, and provider usage telemetry.
- Closed vocabularies for `scope`, `source`, and `trustClass`.
- Constructor and validation helpers, including scope-specific constructors and an asserting constructor for call sites that prefer exceptions.

Each record carries:

- `count`
- `scope`
- `source`
- `trustClass`
- provider/model metadata when provider-sourced
- tokenizer metadata when locally tokenized
- `representationHash` for materialized representation and generated session counts
- `sourceRevision` when the count is tied to source state
- `createdAt`

## Validation Rules

The validator rejects:

- negative or non-integer counts
- unknown scope/source/trust-class values
- invalid `createdAt` timestamps
- negative or non-integer `sourceRevision`
- missing `representationHash` for materialized representation and generated session scopes
- provider usage telemetry that is not sourced from provider usage
- provider usage telemetry without provider and model
- provider-sourced counts without provider and model
- local tokenizer counts without tokenizer metadata

## Intentionally Not Wired

This stage does not:

- switch smart compact budget allocation or selection behavior
- replace current estimator wiring
- capture provider usage telemetry
- persist the new metadata on Thread View, async thread, chunk, placeholder, or generated session records

Those integration points should be handled after the schema is reviewed and Stage 3 defines provider usage capture.

## Verification

Focused unit coverage lives in `tests/token-accounting/token-count-metadata.test.ts`.
