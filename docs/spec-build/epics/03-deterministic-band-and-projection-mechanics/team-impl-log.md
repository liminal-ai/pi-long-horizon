# Team Implementation Log

## Run Overview
- State: COMPLETE
- Spec Pack Root: /Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/03-deterministic-band-and-projection-mechanics
- Current Story: none (all stories accepted)
- Current Phase: none

## Run Configuration
- Primary Harness: claude-code
- Story Lead Provider: codex / gpt-5.5 / high
- Story Implementor: codex / gpt-5.4 / high
- Quick Fixer: codex / gpt-5.4 / high
- Story Verifier: codex / gpt-5.4 / xhigh
- Self Review Passes: 3
- Epic Reviewer 1: codex / gpt-5.4 / xhigh
- Epic Reviewer 2: codex / gpt-5.5 / medium
- Epic Reverifier: codex / gpt-5.4 / xhigh
- Degraded Diversity: false

## Provider Matrix
- Primary: claude-code v2.1.138 — authenticated (Max subscription, lee.g.moore@gmail.com)
- Secondary: codex-cli v0.130.0 — binary present, auth status unknown

## Verification Gates
- Story Gate: `npm run verify`
- Story Gate Source: repo-root package.json scripts (preferred verify because green-verify includes guard:no-test-changes)
- Epic Gate: `npm run verify-all`
- Epic Gate Source: repo-root package.json scripts (preferred verify-all for full coverage including integration and E2E)
- Gate Discovery Rationale: Candidates considered: `npm run verify`, `npm run green-verify`, `npm run verify-all`. Selected `verify` for story gate because stories legitimately add tests and `green-verify` includes `guard:no-test-changes`. Selected `verify-all` for epic gate to include integration and E2E suites.

## Spec Pack Shape
- Tech Design Shape: four-file (tech-design.md + tech-design-thread.md + tech-design-thread-view.md + test-plan.md)
- Prompt Inserts: both absent (non-blocking)

## Story Sequence
1. 00-foundation — Story 0: Foundation
2. 01-deterministic-smooth-turns — Story 1: Deterministic Smooth Turns
3. 02-deterministic-chunk-lifecycle — Story 2: Deterministic Chunk Lifecycle
4. 03-placeholder-lower-fidelity-outputs — Story 3: Placeholder Lower-Fidelity Outputs
5. 04-deterministic-band-rebuild — Story 4: Deterministic Band Rebuild
6. 05-manual-smart-compact-and-pi-reload — Story 5: Manual Smart Compact And PI Reload
7. 06-blocked-and-degraded-maintenance-state — Story 6: Blocked And Degraded Maintenance State

## Current Continuation Handles
- Story Implementor:
  - Story: none
  - Provider: none
  - Session ID: none
  - Result Artifact: none
- Story Verifier:
  - Story: none
  - Provider: none
  - Session ID: none
  - Result Artifact: none

## Story Receipts

### 00-foundation
- Story Title: Story 0: Foundation
- Implementor Evidence: artifacts/00-foundation/003-implementor.json
- Verifier Evidence:
  - artifacts/00-foundation/006-verify.json (initial — revise, S0-F001 blocking)
  - artifacts/00-foundation/009-verify.json (follow-up — pass)
- Quick Fix Evidence: artifacts/quick-fix/001-quick-fix.json (S0-F001 fixture builder fix)
- Final Package: artifacts/00-foundation/story-lead/001-final-package.json
- Story Gate: `npm run verify` — pass (196 unit tests, 0 failures)
- Epic Gate: `npm run verify-all` — pass (196 unit + 8 integration + 33 E2E = 237 tests, 0 failures)
- Dispositions:
  - S0-F001: fixed (scoped fixture builder issue, quick-fixed and re-verified)
- Open Risks:
  - none
- Baseline Before: 560 (test files)
- Baseline After: 560 (test files — 4 new foundation tests added, no regressions)

### 01-deterministic-smooth-turns
- Story Title: Story 1: Deterministic Smooth Turns
- Implementor Evidence: artifacts/01-deterministic-smooth-turns/003-implementor.json
- Verifier Evidence:
  - artifacts/01-deterministic-smooth-turns/005-verify.json (initial — revise, smooth-turn-stale-write-clobber)
  - artifacts/01-deterministic-smooth-turns/006-verify.json (follow-up — revise, finding persisted)
  - artifacts/01-deterministic-smooth-turns/007-verify.json (fresh pass — pass)
- Quick Fix Evidence:
  - artifacts/quick-fix/002-quick-fix.json (first fix attempt)
  - artifacts/quick-fix/003-quick-fix.json (second fix attempt — resolved)
- Final Package: artifacts/01-deterministic-smooth-turns/story-lead/001-final-package.json
- Story Gate: `npm run verify` — pass (207 unit tests, 0 failures)
- Epic Gate: `npm run verify-all` — pass (207 unit + 8 integration + 33 E2E = 248 tests, 0 failures)
- Dispositions:
  - smooth-turn-stale-write-clobber: fixed (stale whole-snapshot writes could clobber smooth-turn persistence; required two quick-fix rounds)
- Open Risks:
  - none
- Baseline Before: 561 (test files)
- Baseline After: 562 (test files — 11 new smooth-turn tests added, no regressions)

### 02-deterministic-chunk-lifecycle
- Story Title: Story 2: Deterministic Chunk Lifecycle
- Implementor Evidence: artifacts/02-deterministic-chunk-lifecycle/003-implementor.json
- Verifier Evidence:
  - artifacts/02-deterministic-chunk-lifecycle/005-verify.json (initial — pass)
- Final Package: artifacts/02-deterministic-chunk-lifecycle/story-lead/001-final-package.json
- Story Gate: `npm run verify` — pass (219 unit tests, 0 failures)
- Epic Gate: `npm run verify-all` — pass (219 unit + 8 integration + 33 E2E = 260 tests, 0 failures)
- Dispositions:
  - none (clean first-pass verification)
- Open Risks:
  - none
- Baseline Before: 562 (test files)
- Baseline After: 563 (test files — 12 new chunk lifecycle tests added, no regressions)

### 03-placeholder-lower-fidelity-outputs
- Story Title: Story 3: Placeholder Lower-Fidelity Outputs
- Implementor Evidence: artifacts/03-placeholder-lower-fidelity-outputs/003-implementor.json
- Verifier Evidence:
  - artifacts/03-placeholder-lower-fidelity-outputs/005-verify.json (initial — pass)
- Final Package: artifacts/03-placeholder-lower-fidelity-outputs/story-lead/001-final-package.json
- Story Gate: `npm run verify` — pass (228 unit tests, 0 failures)
- Epic Gate: `npm run verify-all` — pass (228 unit + 8 integration + 33 E2E = 269 tests, 0 failures)
- Dispositions:
  - none (clean first-pass verification)
- Open Risks:
  - none
- Baseline Before: 563 (test files)
- Baseline After: 564 (test files — 9 new placeholder tests added, no regressions)

### 04-deterministic-band-rebuild
- Story Title: Story 4: Deterministic Band Rebuild
- Implementor Evidence: artifacts/04-deterministic-band-rebuild/003-implementor.json
- Verifier Evidence:
  - artifacts/04-deterministic-band-rebuild/005-verify.json (initial — pass)
- Final Package: artifacts/04-deterministic-band-rebuild/story-lead/001-final-package.json
- Story Gate: `npm run verify` — pass (245 unit tests, 0 failures)
- Epic Gate: `npm run verify-all` — pass (245 unit + 8 integration + 33 E2E = 286 tests, 0 failures)
- Dispositions:
  - none (clean first-pass verification)
- Open Risks:
  - none
- Baseline Before: 564 (test files)
- Baseline After: 565 (test files — 17 new band rebuild tests added, no regressions)

### 05-manual-smart-compact-and-pi-reload
- Story Title: Story 5: Manual Smart Compact And PI Reload
- Implementor Evidence: artifacts/05-manual-smart-compact-and-pi-reload/003-implementor.json
- Verifier Evidence:
  - artifacts/05-manual-smart-compact-and-pi-reload/005-verify.json (initial — revise, SV-05-001/002)
  - artifacts/05-manual-smart-compact-and-pi-reload/008-verify.json (revise, SV-05-001 persisted)
  - artifacts/05-manual-smart-compact-and-pi-reload/009-verify.json (revise, SV-05-001 output path)
  - artifacts/05-manual-smart-compact-and-pi-reload/010-verify.json (revise, preflight behavior)
  - artifacts/05-manual-smart-compact-and-pi-reload/012-verify.json (revise, arg handling + reload)
  - artifacts/05-manual-smart-compact-and-pi-reload/013-verify.json (needs-human-ruling, SV-05-001 system-role)
- Quick Fix Evidence:
  - artifacts/quick-fix/004-quick-fix.json through 009-quick-fix.json (six fix rounds)
- Final Package: artifacts/05-manual-smart-compact-and-pi-reload/story-lead/001-final-package.json
- Impl-Lead Ruling: SV-05-001 — PI upstream contract has no system role; remove system-role serialization, exclude system-origin records from PI projection
- Story Gate: `npm run verify` — pass (272 unit tests, 0 failures)
- Epic Gate: `npm run verify-all` — pass (272 unit + 10 integration + 34 E2E = 316 tests, 0 failures)
- Dispositions:
  - SV-05-001: fixed (system-role preservation removed per impl-lead ruling — PI contract doesn't support it)
  - SV-05-002: fixed (production command surface wiring)
  - Multiple production-path findings: fixed across six quick-fix rounds (output path, preflight, args, reload, role preservation)
- Open Risks:
  - none
- Baseline Before: 566 (test files)
- Baseline After: 570 (test files — 30 new smart compact tests + 2 integration + 1 E2E, no regressions)

### 06-blocked-and-degraded-maintenance-state
- Story Title: Story 6: Blocked And Degraded Deterministic Maintenance State
- Implementor Evidence: artifacts/06-blocked-and-degraded-maintenance-state/003-implementor.json
- Verifier Evidence:
  - artifacts/06-blocked-and-degraded-maintenance-state/005-verify.json (initial — revise, 3 findings)
  - artifacts/06-blocked-and-degraded-maintenance-state/007-verify.json (follow-up — pass)
- Story-Continue Evidence: artifacts/06-blocked-and-degraded-maintenance-state/006-continue.json
- Final Package: artifacts/06-blocked-and-degraded-maintenance-state/story-lead/001-final-package.json
- Story Gate: `npm run verify` — pass (285 unit tests, 0 failures)
- Epic Gate: `npm run verify-all` — pass (285 unit + 10 integration + 34 E2E = 329 tests, 0 failures)
- Dispositions:
  - F6-01-materializer-silent-missing-messages: fixed
  - F6-02-chunk-inspection-misses-broken-source-turns: fixed
  - F6-03-threshold-degrade-not-inspectable: fixed
- Open Risks:
  - none
- Baseline Before: 573 (test files)
- Baseline After: 575 (test files — 13 new blocked/degraded observability tests, no regressions)

## Cumulative Baselines
- Baseline Before Current Story: 573
- Expected After Current Story: N/A (all stories complete)
- Latest Actual Total: 575 (test files); 331 test cases (287 unit + 10 integration + 34 E2E)

## Epic Closeout
- Current Epic Review Artifact: artifacts/epic/001-epic-review.json
- Epic Review Status: pass (after one fix round)
- Epic Fix Status: cleaned (EV-03-001 zero-smooth materializer regression, EV-03-002 missing regression tests)
- Epic Reverify Status: ready-for-closeout
- Final Gate Status: pass (287 unit + 10 integration + 34 E2E = 331 tests, 0 failures)

## Open Risks / Accepted Risks
- Codex auth status unknown — proceeding on assumption CLI works in this environment

## Post-Closeout Stabilization (Pre-Epic 4)

Codex review identified that Epic 3 is behaviorally correct but architecturally incomplete.
The intended surface split is partly facades over old modules, projection-era vocabulary
persists in the critical path, error model is inconsistent, and Feature 3 integration/E2E
coverage is thinner than the test plan specified. All must be resolved before Epic 4.

### Round 1: Structural Consolidation
- Scope: surface migration (re-exports → real implementations), projection vocabulary
  cleanup, error model tightening in the Feature 3 critical path
- Implementor: gpt-5.5 / low — session 019e16d6-d028-7611-be7d-d89c06f64b95
- Verifier: gpt-5.5 / medium
- Verifier: gpt-5.5 / medium — session 019e16dc-072f-7161-b6d4-aaabe49ca6de
- Status: COMPLETE — verifier signed off after 2 impl passes + 2 verify passes

#### R1 Impl Pass 1
- Reversed critical facades: thread/, thread-view/, workbench/ now own real implementations;
  old context-steward/, context-workbench/ are compatibility re-exports
- smart-compact.ts updated to Feature 3 vocabulary (Thread View output naming wrappers)
- pi-thread-view-file.ts imports from new thread-view domain
- Raw throw new Error() replaced with structured SmartCompactCommandResult blockers
  and StewardResultError in smart-compact.ts and async-thread services
- verify-all green: 287 unit + 10 integration + 34 E2E = 331 tests, 0 failures

#### R1 Verify Pass 1 — REVISE
- Check 1 (facades): FAIL — thread-view/domain/thread-view-errors.ts still re-exports from workbench/
- Check 2 (smart-compact imports): PASS at command level, FAIL at internal level —
  thread/domain/ids.ts still has createProjectionRevisionId, thread/services/thread-service.ts
  still has updateGeneratedSessionMetadata, projectionSummary, nextProjectionSummary
- Check 3 (pi-thread-view-file imports): PASS
- Check 4 (raw throw): PASS — no remaining raw throw new Error()
- Check 5 (old compat re-exports): PASS — reversed correctly
- Check 6 (verify-all): PASS — 287 unit + 10 integration + 34 E2E = 331 green

#### R1 Impl Pass 2
- thread-view/domain/thread-view-errors.ts: moved real error vocabulary from workbench,
  workbench-errors.ts now re-exports from thread-view
- thread/domain/ids.ts: createThreadViewOutputRevisionId is now real impl,
  createProjectionRevisionId is compatibility alias
- thread/services/thread-service.ts: updateGeneratedThreadViewOutputMetadata is now real
  impl with Feature 3 vocabulary, old names are compatibility wrappers.
  Persisted projectionSummary field kept for on-disk schema compat.
- verify-all green: 287 unit + 10 integration + 34 E2E = 331 tests, 0 failures

#### R1 Verify Pass 2 — SIGN-OFF
- Check 1 (thread-view-errors): PASS — real implementation, workbench re-exports from it
- Check 2 (output metadata): PASS — Feature 3 names are real, old names are aliases,
  persisted field stays projectionSummary for disk compat
- Check 3 (verify-all): PASS — 331 green
- Verdict: SIGN-OFF

### Round 2: Test Gap Closure
- Scope: missing lower-band integration test, expanded Feature 3 E2E scenarios
- Implementor: gpt-5.5 / low — session 019e16e2-a332-7661-8c1d-35c604e2c234
- Verifier: gpt-5.5 / medium
- Status: COMPLETE — verifier signed off after 1 impl pass + 1 verify pass

#### R2 Impl Pass 1
- Created tests/workbench/workbench-lower-band.integration.test.ts:
  real file-backed stores, production WorkbenchQueryService with real ThreadStoreChunkReader,
  persisted chunk state, placeholder availability, lower-band readiness, open chunk exclusion
- Expanded tests/commands/smart-compact.e2e.test.ts with 8 new E2E scenarios:
  1. Invalid inputs reject before state mutation
  2. Open chunk excluded from lower bands during rebuild
  3. Missing smooth blocks strict-mode compact (SMOOTH_MISSING)
  4. Missing placeholder blocks lower-band use (CHUNK_PLACEHOLDER_MISSING)
  5. Full-fidelity-only overage produces degraded threshold (LOWER_THRESHOLD_UNREACHED)
  6. PI write success + load failure reports reload_failed
  7. Degraded compact leaves inspectable state (usableStatus: "degraded")
  8. Restart survival — persisted smooth/chunk/placeholder survives store reopen
- verify-all green: 287 unit + 11 integration + 42 E2E = 340 tests, 0 failures

#### R2 Verify Pass 1 — SIGN-OFF
- Lower-band integration: PASS — real stores, real chunk reader, real readiness, real assertions
- All 8 E2E scenarios: PASS — exercise real runSmartCompact path, real stores, real file writes,
  specific behavioral assertions (not just "doesn't crash")
- Only PI reload adapter doubled where appropriate (load failure scenario)
- Targeted runs confirmed: integration 1/1 pass, e2e 9/9 pass
- Full gate: PASS — 287 unit + 11 integration + 42 E2E = 340 green
- Verdict: SIGN-OFF

### Post-Stabilization Final State
- Total tests: 340 (287 unit + 11 integration + 42 E2E)
- Baseline: 560 test files (pre-Epic 3) → 577 test files (post-stabilization)
- All Feature 3 mechanics covered by dedicated tests
- Architecture consolidated: new surfaces are real, old surfaces are compat re-exports
- Feature 3 vocabulary is primary, projection-era names are compatibility aliases
- Error model unified on structured results in the core loop
