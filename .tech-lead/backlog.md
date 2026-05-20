# Tech Lead Backlog

Active implementation/process issues to keep visible for PI Long Horizon.

## Highest Priority

### 1. Incremental async exact token repair

Post-smart-compact turns currently accumulate heuristic raw/smooth/chunk-smooth counts during normal use.

Current issue: async thread maintenance skips the whole-thread exact-count repair sweep to avoid expensive post-turn work, but there is no incremental exact-count repair path replacing it.

Desired direction:
- keep exact counting async;
- count newly closed turns and affected chunks incrementally;
- keep smart compact `prepare` as full catch-up/repair;
- allow strict smart compact to work after normal settled use.

### 2. Smart compact progress feedback

Smart compact can sit silent for 30-60s+ during prepare/generate/reload.

Need at least:
- command-start notification/status;
- status cleared in `finally`;
- later: phase updates for prepare, token repair, projection, final count, write/reload.

### 3. Smart compact / background stderr UI pollution

Raw service warnings can currently bleed into the PI conversation surface via stderr. Example: lower-band compression warnings like `Chunk chunk-042 detailed transcript exceeded 4000 estimated tokens...` appeared inline in the agent chat and visually corrupted the response.

Higher-priority fix:
- stop background/service warnings from writing directly to stderr during agent conversation;
- route them to structured logs/debug files, command reports, or PI UI notifications/status surfaces;
- ensure background maintenance cannot interleave raw warning text into assistant/user message rendering.

### 4. Smart compact error reporting

Current failures collapse into generic messages like “blocked before generated output,” hiding actual stage/scope.

Need blocker/error messages that preserve:
- phase;
- scope;
- turn/chunk id where relevant;
- status code/error code;
- sanitized provider error when safe.

### 5. Warning formatting/wrapping when surfaced

If lower-band/smart-compact warnings are intentionally surfaced to the user, they need clean formatting so they do not wrap or merge into surrounding conversational text.

Lower-priority fix:
- add newline separation/prefixing;
- format as command/report issues rather than raw console text;
- avoid long unstructured lines in the terminal UI.

## Context Inspection / SDK CLI

### 4. `lh-context` compound post-compact report

The first SDK/CLI slice provides useful primitives (`summary`, `tokens`, `bands`), but post-smart-compact verification still requires shell glue and repeated command composition.

Add a compound report command, likely:
- `lhx report post-compact --root .`
- `lhx report post-compact --root . --json`

It should combine:
- summary;
- generated session token count and provenance;
- degraded/repair-needed status;
- token rollups;
- band layout;
- warnings/mismatches, including diagnostic/fallback assistant usage differing from authoritative generated-session metadata.

Goal: one standard clean report after smart compact, no ad hoc bash or Node one-liners.

### 5. `lh-context` next slice

The first SDK/CLI slice covers summary, tokens, and generated bands. Next commands should add:
- `turns`;
- `turn <index|id>`;
- `chunks`;
- `chunk <id>`;
- `readiness`.

`readiness` should answer: strict compact likely OK, or use prepare?

### 5. Live-tail/current-active-context accounting

Need an inspection surface that distinguishes:
- last compact generated bands;
- live turns appended after reload;
- current active full-fidelity/live region;
- hypothetical next compact selection.

This was a repeated confusion source and should be made explicit.

### 6. Snapshot/restore workflow

`.thread-snapshots` now stores heavyweight snapshots and a catalog README.

Future command should support:
- create snapshot;
- capture metadata/counts;
- catalog entry;
- possibly restore instructions or restore operation.

## Manual Memory Curation

### 7. Manual smooth/projection curation support

We manually edited derived smooth state and the active projection to remove an accidentally pasted large transcript from prompt-visible memory while preserving canonical source.

Need eventual supported operations with provenance/audit:
- manual smooth override;
- invalidate lower-band projection/chunk artifacts;
- optional projection edit helper;
- clear distinction from canonical source edits.

### 8. Projection/session edit hygiene

Generated thread-view files may be manually edited during dogfood. Need clearer rules and support around:
- canonical vs projection edits;
- reload behavior;
- backup before projection edits;
- audit notes for manual curation.

## Lower-Band / Smart Compact Quality

### 9. Lower-band artifact provenance

Detailed/brief lower-band artifacts should carry provider provenance so deterministic fallback cannot satisfy inference-generated artifact tests.

Need ensure final code/tests preserve:
- provider id;
- model id;
- prompt version;
- reasoning effort/usage where available;
- no deterministic ready fallback for semantic artifacts.

### 10. E2E coverage gaps

Maintain focused high-signal E2E tests for things that actually broke:
- async thread view reaches OpenAI token counting;
- detailed and brief inference artifacts are generated and persisted;
- generated rollout includes expected source types.

Avoid broad noisy E2E when service tests already cover policy details.

### 11. Tool-result truncation policy refinement

Current prompt-visible tool-result truncation works as a blunt pressure valve.

Future refinements:
- head+tail retention;
- preserve error tails/stack traces;
- per-tool policies;
- command metadata;
- important-output hints.

### 12. Band terminology and expectations

Band percentages are allocation hints, not guarantees.

Consider docs/UI terminology such as:
- `bandShape`;
- `bandWeights`;
- `allocationHints`.

## Process / Architecture

### 13. Context Workbench scope correction

Avoid rebuilding an overwrought UI first. Build the legible SDK/CLI surface first, then adapt it into PI, Fastify, web, or other harnesses.

### 14. Liminal Spec process notes into actual skills/tools

We updated notes on:
- story sharding;
- enrichment;
- implementation orchestration;
- boundary issues;
- artifact-vs-git truth;
- production/runtime path proof.

Need later fold these lessons into the actual skills and lbuild-impl CLI.

### 15. Package/repo structure and publish wiring

`packages/lh-context` exists as one package exposing SDK + CLI.

Need later decide:
- root workspace wiring;
- root scripts;
- package name/versioning;
- npm publish path;
- integration with PI extension.

### 16. Globally available long-horizon tooling

Make the new SDK/CLI and related long-horizon support tools available from any directory where a long-horizon agent may be launched.

Things to resolve:
- how `lhx` / `lh-context` is installed or linked globally during dogfood;
- whether root scripts, npm global install, pnpm workspace linking, or local shim scripts are preferred;
- how agents discover the right project root and `.context-steward` directory from arbitrary working directories;
- what environment variables/config files are needed in each launch context;
- how PI, other CLI harnesses, and future service-based harnesses access the same tools consistently.

Goal:
- a fresh agent in any relevant project directory can run the inspection CLI without bespoke setup or path spelunking.

### 17. LLM/Keeper Wiki durable knowledge layer

Explore a Karpathy-style LLM wiki as an additional long-horizon memory layer. This may become a PRD or an epic depending on scope.

General direction:
- wiki contains raw/source docs plus derived LLM-maintained pages;
- spec packs can enter as raw authoritative sources, likely piece by piece;
- a dedicated wiki/kb keeper agent ingests sources, updates pages, maintains `index.md` and `log.md`, and answers questions from the wiki;
- recurring modes may include `ingest-source`, `ingest-spec-pack`, `answer-question`, `reconcile`, `lint-maintenance`, and periodic maintenance;
- derived pages should help agents answer questions without rereading full spec packs every time, while linking back to authoritative sources.

Potential value:
- durable synthesized project understanding;
- onboarding surface for fresh long-horizon agents;
- bridge between Liminal Spec source artifacts and current project mental model;
- place to file valuable answers and cross-document synthesis.
