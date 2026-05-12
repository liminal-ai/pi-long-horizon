# Stage 8 Generated Session Validation And Cleanup

Date: 2026-05-12

## Scope

Stage 8 validates the actual generated PI session representation after Thread View allocation and PI file construction, before any generated session is written or reloaded.

The validation counts the exact JSONL string that `writePiThreadViewFile` would write by using the Stage 4 `countGeneratedSession` counter. The resulting `generated_session` `TokenCountRecord` is evaluated with the Stage 5 counter source policy in prepare mode, matching the current reality that the available generated-session counter is a degraded PI heuristic rather than provider input-count evidence.

## Runtime Behavior

`runSmartCompact` now:

- builds the draft Thread View as before
- builds the PI Thread View file object
- counts the generated session JSONL before write/reload
- persists generated-session count metadata on generated output metadata
- blocks write/reload when generated-session count exceeds `requestedLowerBound`

When the generated session exceeds the requested lower bound, smart compact returns degraded with `GENERATED_SESSION_OVER_LOWER_BOUND`. The issue includes both the generated session count and requested lower bound. No generated file is written, no thread-id map is recorded, and PI is not reloaded.

If generated-session accounting itself is blocked by policy, smart compact returns blocked with `TOKEN_COUNT_BLOCKED` before write/reload.

## Retry

This stage does not retry allocation by reducing older/lower-fidelity content. The current Stage 7 allocator does not expose a narrow hook for "same newest indivisible content, less older/lower-fidelity content" without changing allocation semantics. Stage 8 therefore makes the no-reload behavior explicit and documents allocation retry as a later improvement.

Newest indivisible overage that is already detected by Thread View allocation continues to return the existing `LOWER_THRESHOLD_UNREACHED` degraded result before generated file construction. Stage 8 does not replace that clearer reason with a generated-session overage issue.

## Metadata And Audit

Generated output metadata may now include:

- `requestedLowerBound`
- `generatedSessionTokenCount`
- `generatedSessionTokenCountMetadata`
- `generatedSessionCountPolicy`

Compaction audit reports expose generated-session count and policy status when generated output metadata is available. The text formatter also prints those fields.

## Generated Assistant Usage

PI assistant session entries still require a usage-shaped field for compatibility. Stage 8 keeps zero-valued generated usage, but the generated output metadata entry now labels it as synthetic generated-session compatibility metadata:

- `source: "synthetic_generated_session_required_by_pi"`
- `providerReported: false`

This synthetic usage is not provider usage telemetry and is not used as a materialized or generated-session token count.

## Cleanup Notes

Critical smart compact generated-session validation no longer depends on `pi-token-estimator` directly. The remaining `pi-token-estimator` usage is isolated behind the Stage 4 materialized representation counter and existing maintenance/helper compatibility paths. Removing it entirely would require a broader maintenance-threshold and fixture rewrite, so that cleanup is left for a later stage.

## Verification

Focused coverage includes:

- generated session over requested lower bound degrades before write/reload
- generated session under requested lower bound writes and reloads
- audit report exposes generated-session count and policy status
- generated assistant usage is explicitly marked synthetic and is not confused with provider usage telemetry
