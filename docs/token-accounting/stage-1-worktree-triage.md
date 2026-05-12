# Stage 1 Worktree Triage And Repro Lock

Date: 2026-05-12

## Scope

Stage 1 only classified the current dirty worktree and locked down the best available deterministic audit loop for the smart compact token-accounting failure. It did not implement the token accounting schema or change production accounting behavior.

Terminology note: use Thread View, materialized representation, generated session, and materialized token count. Legacy code and store files may still contain names from earlier eras.

## Recent History

Recent commits in the last 36 hours:

| Commit | Time | Relevance |
| --- | --- | --- |
| `fb0e6e5` | 2026-05-11 15:14 -0400 | Added compaction audit tooling, large-session scripts, real PI fixture, and dogfood fixes. This is the best base for Stage 1 audit commands. |
| `1ef843d` | 2026-05-11 08:26 -0400 | Removed most old naming from user-facing architecture/code surfaces. |
| `445af43` | 2026-05-11 08:00 -0400 | Epic 3 stabilization and test-gap closure. |
| `5efd02b` | 2026-05-11 07:10 -0400 | Deterministic band and Thread View mechanics closeout. |
| `a32f1f0` | 2026-05-11 02:14 -0400 | Blocked/degraded maintenance state work. |
| `780d4f9` | 2026-05-11 01:44 -0400 | Manual smart compact command, atomic write, archive, and reload. |

## Dirty Worktree Classification

| Path or group | Classification | Notes |
| --- | --- | --- |
| `src/thread-view/services/pi-token-estimator.ts` | Keep/adapt for token accounting | Introduces PI package `estimateTokens` against PI-shaped messages. This is directly relevant as an experiment, but it is currently uncommitted and coupled straight into production paths. Stage 2 should evaluate it as an adapter candidate, not accept it wholesale. |
| `src/thread-view/services/thread-view-builder.ts` | Keep/adapt for token accounting | Moves raw/materialized count estimation out of the builder and changes full-fidelity/smooth/placeholder counting. Relevant, but current behavior breaks existing builder expectations, so Stage 2 needs a deliberate accounting contract before keeping this shape. |
| `src/thread/async-thread/services/async-thread-run-service.ts`, `chunk-service.ts`, `placeholder-artifact-service.ts`, `smooth-turn-format.ts`, `smooth-turn-service.ts` | Keep/adapt for token accounting | Replaces deterministic word-count checks with PI estimator counts across smooth/chunk/placeholder maintenance. Relevant to count drift, but risky because existing persisted fixtures and readiness checks now disagree. |
| `tests/thread-view/thread-view-builder.test.ts`, `tests/thread-view/helpers.ts` | Keep/adapt for token accounting | Adds a dense tool-output selection test and updates fixture token counts. Useful repro seed, but existing test expectations now fail, which is valuable evidence for Stage 2. |
| `tests/workbench/compaction-report-large-session.test.ts` | Keep/adapt for token accounting | Existing committed audit test now fails under dirty changes because placeholder readiness no longer matches. Keep as an audit loop target. |
| `src/thread-view/targets/pi/pi-thread-view-writer.ts`, `src/thread-view/targets/pi/pi-thread-view-builder.ts`, `src/thread-view/domain/pi-thread-view-file.ts`, `tests/thread-view/pi-thread-view-writer.test.ts`, `src/thread-view/test/fixtures.ts` | Replace/move | Adds generated-session model/thinking settings, hidden custom messages for compacted content, and stricter tool-call ID serialization. These are adjacent generated-session fidelity changes, not Stage 1 token accounting. Stage 2 should move them into a separate generated-session compatibility track or rebase only the parts needed for materialized token count measurement. |
| `src/commands/smart-compact.ts`, `tests/commands/smart-compact.test.ts`, `tests/commands/smart-compact.e2e.test.ts` | Replace/move | Adds short generated session IDs and thread-id mapping during smart compact. Related to post-compact PI reload/capture continuity, not the accounting root cause. Keep out of the Stage 2 accounting schema unless needed for measuring generated sessions. |
| `src/thread/store/file-thread-store.ts`, `src/thread/store/thread-store.ts`, `src/thread/services/thread-service.ts`, `tests/context-steward/thread-store.test.ts` | Replace/move | Adds `threadId-map.json` identity mapping and reconciliation. Useful for generated-session continuity, but not a token-accounting primitive. Needs its own design/review because it mutates store behavior and target identity semantics. |
| `src/context-steward/pi/pi-extension.ts`, `src/context-steward/pi/pi-message-mapper.ts`, `tests/context-steward/capture-service.test.ts`, `tests/context-steward/pi-extension-commands.test.ts` | Risky/needs user decision | Removes runtime-note capture, changes session-start behavior, and smooths closed turns on `turn_end`. This changes live capture semantics while the accounting bug is unresolved. Do not silently keep or revert. |
| `package.json`, `.pi/settings.json` | Defer/unrelated | Removes default model/thinking settings from local agent config/scripts. Not part of accounting. |
| `thread_2bbccbae-bf23-4a4c-a742-26528e6e5ab9/index.json` | Defer/unrelated | Untracked generated-looking store directory containing only an empty index. Do not commit as accounting work. |

## Repro And Audit Loop

Best deterministic commands available now:

```sh
npm run typecheck
node --import tsx --test tests/thread-view/thread-view-builder.test.ts tests/workbench/compaction-report-large-session.test.ts
node --import tsx scripts/seed-large-session.ts 12000 /tmp/pi-token-audit
node --import tsx scripts/run-compact.ts /tmp/pi-token-audit <thread-id-from-seed> 6000 --mode=prepare
node --import tsx scripts/compact-report.ts /tmp/pi-token-audit <thread-id-from-seed>
```

The first two commands are the locked Stage 1 smoke loop because they run without manual thread-id handoff and directly exercise Thread View selection plus compaction audit reporting. The three script commands are the operator audit loop from `fb0e6e5`; they are the right shape for a saved fixture once Stage 2 chooses the accounting contract.

Attempted fixture command:

```sh
node --import tsx scripts/compact-report.ts fixtures/real-pi-session thread_b395ab32-44c9-4fc2-92c8-eaae4f634b61
```

This currently fails with `STORE_UNAVAILABLE: openThread failed.` because `fixtures/real-pi-session` is a fixture payload, not a live store root with the `threads/` layout expected by `FileThreadStore`.

## Observed Current Behavior

`npm run typecheck` passes on the dirty tree.

The focused audit test command fails 4 tests:

| Test | Observed failure |
| --- | --- |
| `rebuild accepts explicit run inputs` | Expected Thread View status `ready`, got `degraded`. |
| `full-fidelity-only overage is explicit` | Expected `degraded`, got `ready`. |
| `rebuild lands at or below lower bound` | Expected `ready`, got `degraded`. |
| `compaction audit report covers all bands for a medium large session` | Large-session seeding fails because chunks `chunk-009` and `chunk-010` are missing deterministic detailed/brief placeholder output required for lower-band rebuild. |

This confirms count drift is now observable in deterministic tests, but the dirty tree is internally inconsistent: changing count semantics invalidates existing smooth/chunk/placeholder readiness and band-status expectations.

## Stage 2 Build-On Points

Stage 2 can safely build on:

- Existing committed audit tooling from `fb0e6e5`: `scripts/seed-large-session.ts`, `scripts/run-compact.ts`, `scripts/compact-report.ts`, `scripts/large-session-lib.ts`, and `tests/workbench/compaction-report-large-session.test.ts`.
- The new dense tool-output test idea in `tests/thread-view/thread-view-builder.test.ts`, because it targets the suspected root cause: dense tool result payloads being undercounted in the full-fidelity band.
- The uncommitted `pi-token-estimator.ts` as a research candidate for materialized token count estimation, pending a schema and persistence decision.

Stage 2 should not safely build on:

- Store identity mapping, generated-session settings, hidden custom compacted messages, or PI capture lifecycle changes without separate user approval.
- The current dirty production wiring of PI estimator counts into smooth/chunk/placeholder validity checks, because it breaks deterministic readiness assumptions before the accounting model is defined.

## Remaining Gap

There is no clean saved repro fixture yet that starts from a known live store, runs smart compact, and asserts that the generated session materialized token count exceeds the requested budget by the observed 87%-to-88% failure shape. The current deterministic gap is smaller but actionable: count-semantics changes alter full-fidelity selection/status decisions and break lower-band audit preparation. Stage 2 should first define canonical materialized token count surfaces, then turn the large-session audit loop into a saved fixture/assertion for tool-call-heavy turns.
