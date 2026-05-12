# Phase A Compatibility Cleanup

Date: 2026-05-12

## Scope

Phase A is a compatibility cleanup pass over active implementation, tests, and active project documentation. It does not redefine the accepted token-accounting baseline from the earlier stages.

In particular, generated-session count gating in `src/commands/smart-compact.ts` is pre-existing retained behavior from the accepted Stage 8 baseline. Phase A did not introduce that target behavior and should not revert it. Stage 8 deliberately validates the generated PI session representation before write/reload, degrades over-target generated sessions, and persists generated-session count metadata.

## Historical Spec-Build Artifacts

Files under `docs/spec-build/` are historical implementation/spec artifacts. They may preserve older terms such as `projectionSummary` because they are evidence from prior story runs, verifier outputs, prompts, and generated artifacts.

Phase A cleanup scans exclude `docs/spec-build/**`. Do not rewrite those historical spec artifacts merely to remove old terms; doing so would mutate audit history rather than clean active code.

## Validation Scans

Use these scans for Phase A cleanup validation:

```sh
# Active code/tests/docs scan for removed symbols, excluding historical spec-build artifacts.
rg -n --glob '!docs/spec-build/**' --glob '!docs/token-accounting/phase-a-compatibility-cleanup.md' 'projectionSummary' src tests docs

# Active src/tests scan for projectionSummary.
rg -n 'projectionSummary' src tests
```

Both commands should return no matches. The first scan excludes this validation note because the note intentionally names the removed symbol while documenting the cleanup boundary.

## Build And Test Validation

Run the normal project checks after the documentation cleanup:

```sh
npm run typecheck
npm run test
```
