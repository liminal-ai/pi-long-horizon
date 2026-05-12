# Final Worktree Reconciliation

Date: 2026-05-12

## Scope

This note reconciles the dirty worktree called out in Stage 1 against the completed token-accounting implementation. The goal is to make the final keep/discard decisions explicit rather than leaving the original whack-a-mole work mixed in by implication.

## Removed Or Restored

| Path | Decision | Reason |
| --- | --- | --- |
| `.pi/settings.json` | Restored to pre-existing defaults | Local agent configuration was classified as unrelated to token accounting. |
| `package.json` | Restored agent scripts to pre-existing defaults | Script default model/thinking changes were unrelated to token accounting. |
| `thread_2bbccbae-bf23-4a4c-a742-26528e6e5ab9/` | Removed | Generated-looking empty store artifact, not part of the implementation. |

## Kept As Token-Accounting Work

| Path or group | Decision | Reason |
| --- | --- | --- |
| `docs/token-accounting/` | Keep | Stage-by-stage design, validation notes, and final behavior documentation. |
| `src/token-accounting/`, `tests/token-accounting/` | Keep | New neutral accounting schema, materialized counters, and source policy. |
| `src/thread/domain/records.ts`, `src/thread/services/capture-service.ts`, `src/context-steward/pi/pi-message-mapper.ts`, provider usage tests | Keep | Provider usage telemetry is now persisted separately from materialized counts. |
| Smooth/chunk/placeholder domain and service changes | Keep | Maintenance artifacts now persist materialized token count metadata as the count surface. |
| `src/thread-view/services/thread-view-builder.ts` and Thread View builder tests | Keep | Allocation now consumes token-accounting records through source policy and reports degraded heuristic decisions. |
| `src/workbench/services/compaction-report-*` and workbench report tests | Keep | Audit reporting now uses the same accounting path as allocation and exposes generated-session counts. |
| `src/commands/smart-compact.ts` and smart compact tests | Keep | Smart compact now gates generated-session write/reload on generated-session count and persists count metadata. |

## Kept Because The Final Solution Depends On Them

| Stage 1 bucket | Path or group | Final decision | Reason |
| --- | --- | --- | --- |
| Replace/move | PI Thread View file builder/writer/domain and writer tests | Keep | Stage 4 and Stage 8 require a shared generated-session serializer and explicit synthetic usage metadata. Tests cover the behavior. |
| Replace/move | Thread identity map store/service/test changes | Keep | Generated rollout sessions need to resolve back to the canonical source thread after reload/capture. Tests cover session-id and generated-file identity mapping. |
| Risky/needs decision | PI extension capture lifecycle changes | Keep for now | The final behavior is covered by tests: session lifecycle events are not stored as source messages, generated rollout sessions resolve through the map, and `turn_end` smoothing is explicit. This is adjacent to token accounting but now part of the passing end-to-end behavior. |
| Keep/adapt | `src/thread-view/services/pi-token-estimator.ts` | Keep as transitional adapter | Critical accounting uses the neutral `src/token-accounting` APIs. The estimator remains as a degraded heuristic implementation detail until a provider/local tokenizer counter replaces it. |

## Not Done In This Pass

- No generated-session retry was implemented. Over-target generated sessions degrade before write/reload; retry is documented as later work.
- No provider network/token-count API integration was added.
- No exact local tokenizer dependency was added. Current local counts are still PI heuristic counts and surface as degraded.

## Verification

Final verification commands:

```sh
npm run typecheck
npm run test
```

Both passed after reconciliation.
