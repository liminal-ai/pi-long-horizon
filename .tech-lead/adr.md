# Tech Lead Architecture Decision Record

Running decision log for PI Long Horizon technical direction.

## 2026-05-20 — Long-horizon agent operating model

Decision: Treat this assistant as a tech-lead style long-horizon agent for the project.

Rationale:
- The agent is holding coherent context across PI Long Horizon architecture, Epic 1 implementation history, Epic 5 smart compact behavior, Liminal Spec process lessons, and the broader agentic software factory vision.
- The useful operating mode is concise tech-lead guidance by default, with deeper detail on request.
- The agent can either get hands dirty, delegate implementation to coding agents, or review/verify work from other agents.

Implications:
- Keep a visible tech-lead backlog and decision log.
- Use implementation agents for bounded coding tasks when appropriate.
- Tech-lead agent verifies architecture fit, tests, and process alignment.

## 2026-05-20 — Context inspection should be SDK-first, CLI-wrapped

Decision: Build a portable stateless SDK plus thin CLI for context inspection and eventually core operations.

Rationale:
- Repeated ad hoc Node scripts were needed to answer basic questions about messages, turns, chunks, bands, token rollups, generated thread views, and readiness.
- Slash commands are not the primary surface for agents; agents can call CLIs/tools more reliably.
- The surface should work beyond PI: other CLI harnesses, Fastify/REST services, web apps, and future store backends.
- A stateless one-shot SDK/CLI gives a legible, reusable agent surface.

Implications:
- SDK functions should accept explicit inputs such as root directory, thread id, thread directory, or thread-view path.
- CLI should be a thin wrapper over SDK calls.
- JSON output should be stable and first-class for agents.
- Human output should remain concise and legible.

## 2026-05-20 — One npm package should publish SDK and CLI together

Decision: Use one package that exports SDK functions and ships a CLI binary, rather than splitting SDK and CLI into separate packages.

Rationale:
- This matches the working pattern in `cxs-cloner` and related cloner tools.
- One npm publish keeps SDK and CLI versions synchronized.
- Consumers can use either:
  - CLI: `lhx summary --root . --json`
  - SDK: `import { inspectSummary } from ...`

Implications:
- Package shape should include:
  - `src/index.ts` for SDK barrel exports;
  - `src/cli.ts` for CLI entrypoint;
  - `src/commands` for thin command wrappers;
  - `src/core` or equivalent for read-only inspectors;
  - `src/output` for human/JSON formatting;
  - `src/types` and `src/errors`.

## 2026-05-20 — `lh-context` should live outside the PI extension source tree

Decision: Put the SDK/CLI package under `packages/lh-context`, not under the root PI extension `src` tree.

Rationale:
- PI is one adapter, not the long-term center of the long-horizon substrate.
- The context inspection/control surface should be portable across PI, other CLI harnesses, services, and future UIs.
- Keeping it outside root `src` prevents the SDK from feeling like a PI-extension submodule.

Implications:
- The package may read current `.context-steward` files directly for now.
- It should not import PI UI or extension modules.
- Later, PI extension can call the SDK instead of owning duplicated logic.

## 2026-05-20 — Node/npm/pnpm/Vitest preferred over Bun for this package

Decision: Use Node-oriented tooling for the SDK/CLI package; do not base it on Bun.

Rationale:
- Node is the stable common denominator for agent harnesses and enterprise environments.
- Bun has had instability/memory issues, especially on Windows.
- Vitest is preferred over Bun test.
- pnpm is likely preferable if/when the repo becomes a workspace/monorepo.

Implications:
- CLI entrypoint should use `#!/usr/bin/env node`.
- Tests should use Vitest.
- Package should remain Node 24 compatible.

## 2026-05-20 — First `lh-context` slice is read-only inspection

Decision: The first SDK/CLI slice should be read-only and cover only summary, token rollups, and generated band inspection.

Rationale:
- The immediate pain was repeated manual inspection scripts.
- Mutations/manual curation are important but risk complicating the first package boundary.
- Read-only inspection validates the shape without destabilizing the core system.

Implemented first commands:
- `lhx summary`;
- `lhx tokens`;
- `lhx bands`.

Deferred:
- turn/chunk drilldown;
- readiness audit;
- live-tail accounting;
- manual smooth/projection edits;
- smart compact operations.

## 2026-05-20 — Context surfaces must be explicitly separated

Decision: Inspection outputs should distinguish different context surfaces instead of collapsing them.

Key surfaces:
1. Canonical Thread — source truth in `.context-steward` messages/turns/chunks.
2. Async artifacts — smooth turns, lower-band projections, chunk detailed/brief summaries, token metadata.
3. Last generated thread-view — smart-compact projection file and selected bands at generation time.
4. Current active PI context — generated file plus live turns appended after reload.
5. Hypothetical next compact allocation — what a new smart compact would select, distinct from current active context.

Rationale:
- Repeated confusion came from mixing active full-fidelity/live tail with hypothetical next-compact selection.
- Agents and humans need fast, legible answers without reconstructing surfaces manually.

Implications:
- `lhx bands` should inspect generated band layout, not guess live tail or next compact selection.
- Live-tail support should be added explicitly later.

## 2026-05-20 — Manual memory curation is valid but should preserve canonical source

Decision: Manual curation may edit derived smooth/projection surfaces, but canonical `messages.jsonl` should remain source truth.

Rationale:
- An accidental large transcript paste caused degraded smooth memory and prompt-visible bloat.
- Manually replacing derived smooth/projection text with an honest note was acceptable dogfood behavior.
- Long-term agents may need power to curate their own prompt-visible memory.

Implications:
- Future manual curation support should include provenance/audit fields.
- Manual smooth overrides should invalidate stale lower-band projections/chunk artifacts.
- Canonical source edits should be treated differently and avoided by default.

## 2026-05-20 — Lower-band semantic artifacts should carry provider provenance

Decision: Ready detailed/brief lower-band artifacts should persist inference provenance.

Rationale:
- Tests that only assert text exists can be satisfied by deterministic fallback or reward-hacking shims.
- Provider provenance makes “ready semantic artifact” mean it came from the inference path.

Desired provenance:
- provider id;
- model id;
- prompt version;
- reasoning effort;
- usage/elapsed info where available.

Implications:
- E2E can assert ready detailed/brief artifacts have provider provenance.
- Deterministic fallback should not produce ready semantic lower-band artifacts.

## 2026-05-20 — Smart compact errors and progress need UX work

Decision: Smart compact needs visible progress and better blocker diagnostics.

Rationale:
- Prepare/generate/reload can take tens of seconds with no indication.
- Current error messages can collapse very different failures into generic text.

Implications:
- Add command status/progress feedback.
- Preserve phase/scope/entity details in blockers.
- Surface first actionable blocker in command output.

## 2026-05-20 — Async exact token counting should be incremental

Decision direction: Normal async thread maintenance should perform exact token-count repair incrementally, not skip it and not rerun an expensive whole-thread sweep every turn.

Rationale:
- Skipping exact raw/smooth/chunk-smooth counts leaves every post-compact turn repair-needed.
- Whole-thread exact repair is too heavy for every normal turn-end maintenance pass.
- The correct shape is async incremental repair for newly affected turns/chunks, with smart compact prepare as full catch-up.

Implications:
- Add a suffix/recent exact-count repair path.
- Keep prepare as comprehensive repair.
- Aim for strict smart compact to work after normal settled use.

## 2026-05-20 — Use Beads for actionable tech-lead backlog

Decision: Use `bd` / Beads as the primary tracker for actionable backlog items instead of maintaining the working backlog as a markdown TODO list.

Rationale:
- The project is moving toward tech-lead agent + coding agents + verifier agents, which needs structured issue state rather than a flat numbered markdown list.
- Beads provides agent-oriented commands (`bd prime`, `bd ready`, `bd show`, `bd update --claim`, `bd close`) and JSON output.
- Priorities, dependencies, blocked/ready state, comments, audit trail, and stable issue IDs are better suited to multi-agent implementation than `.tech-lead/backlog.md`.
- The Beads onboarding model matches our desired legible agent surfaces: a small instruction file can point agents to `bd prime` for current workflow context.

Implementation notes:
- Installed Beads 1.0.4 with Homebrew.
- Initialized Beads in this repo with embedded Dolt storage.
- Converted the current `.tech-lead/backlog.md` items into Beads issues.
- Keep `.tech-lead/adr.md` as the narrative decision/rationale log.
- Treat `.tech-lead/backlog.md` as a historical seed/human summary unless we deliberately keep it synchronized.

Implications:
- New actionable work should be created in Beads, not added only as markdown TODOs.
- Agents should run `bd prime` / `bd ready` to orient to the issue workflow.
- Markdown remains appropriate for ADRs, design notes, specs, and narrative context.
