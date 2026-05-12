# Stage 5 Counter Source Policy

Date: 2026-05-12

## Scope

Stage 5 adds a neutral counter source policy under `src/token-accounting/`. It classifies existing `TokenCountRecord` metadata for a requested materialized count or generated session count and returns whether that count is usable, degraded, or blocked.

This stage does not switch smart compact allocation, select Thread View bands differently, backfill old counts, or call provider APIs. It prepares Stage 6/7 by making trust decisions explicit before any runtime path depends on them.

## Added Policy Surface

`src/token-accounting/counter-source-policy.ts` exports:

- `evaluateTokenCountRecordForScope`, which evaluates one `TokenCountRecord` against a requested materialized or generated-session scope.
- `selectTokenCountRecordForScope`, which chooses the highest-precedence count from a set of records when at least one record is usable for the requested scope.
- `getTokenCountSourcePrecedence`, exposing the policy ordering for diagnostics and tests.
- Closed vocabularies for policy modes and decision statuses.

Decision statuses:

- `usable`: trusted enough for a successful smart compact decision in the current mode.
- `degraded`: usable only with a warning in the current mode.
- `blocked`: not trusted for a successful smart compact decision.

Policy modes:

- `strict`: blocks degraded heuristic counts.
- `prepare`: allows degraded PI heuristic counts with a warning, but still blocks provider usage telemetry.

## Source Precedence

The policy ranks count sources in this order:

| Source | Decision | Notes |
| --- | --- | --- |
| `provider_input_count` | usable | Highest-trust source for provider input counts or provider-reported generated session counts, where available. |
| `local_tokenizer` | usable | Normal usable count for materialized allocation when an exact provider count is unavailable. |
| `pi_heuristic` | degraded or blocked | Degraded fallback. `prepare` mode may allow it with warning; `strict` mode blocks it. |
| `provider_usage` | blocked | Provider usage telemetry only. It reports assistant-call usage and is not a materialized count. |

The evaluator also blocks invalid records, scope mismatches, and provider usage telemetry records requested as materialized or generated-session counts.

## Provider Usage Boundary

Provider usage telemetry remains separate from materialized counts. A `provider_usage_telemetry` record can describe what the provider reported for an assistant call, but it does not answer how many tokens a Thread View materialized representation or generated session will consume. Stage 5 therefore blocks `provider_usage` as a counter source for materialized and generated-session requests.

## Intentionally Not Wired

This stage does not:

- change `runSmartCompact`
- change Thread View allocation or selection
- persist new policy decisions
- add provider exact-count API calls
- implement maintenance rollups or backfills

## Verification

Focused unit coverage lives in `tests/token-accounting/counter-source-policy.test.ts`.
