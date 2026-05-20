# Quick-Fix: Story 6 Remaining Verifier Findings

## Context

Story 6 (Remove Placeholder Runtime Path) has 3/8 TCs verified but 5 remain unproven after the story-orchestrate stalled mid-continue. Gates pass (485 tests, 0 failures). The core placeholder removal from runtime paths was done but the verifier identified 3 remaining gaps (the gate flakiness finding is now fixed).

## Tasks

### Task 1: Compaction report cutover (SV story-6-compaction-report-still-placeholder-backed)

`src/workbench/services/compaction-report-service.ts` still reads placeholder-era lower-band state for its audit summaries. Update it to read semantic artifact state (`chunk.lowerBand.detailed` / `chunk.lowerBand.brief`) instead of placeholder fields. Update `tests/workbench/compaction-report-service.test.ts` to assert the report uses semantic artifact readiness, not placeholder readiness.

**Affected TCs:** AC-4.5, TC-4.5a

### Task 2: Runtime readiness and inspection API cutover (SV story-6-runtime-contract-still-placeholder-named)

Runtime readiness and inspection APIs still preserve placeholder compatibility shims. Check these surfaces and ensure they report based on semantic lower-band artifact state:
- `src/workbench/services/workbench-query-service.ts`
- `src/workbench/services/active-rollout-inspection-service.ts`

Update tests to assert placeholder-named fields/responses are not used as the readiness truth.

**Affected TCs:** AC-4.5, TC-4.5b

### Task 3: E2E placeholder-free assertion (SV story-6-e2e-proof-still-allows-placeholder-path)

The E2E test at `tests/context-steward/long-thread-real-pi-execution.e2e.test.ts` should assert that generated rollout output contains semantic lower-band text and does NOT contain deterministic placeholder detailed/brief fallback text. If the E2E already has assertions about lower-band output, tighten them to reject placeholder patterns (like exact deterministic substring summaries that the old placeholder generator would produce).

**Affected TCs:** TC-4.4a, TC-4.5b

### Task 4: Ensure placeholder output not emitted test (TC-4.4a)

In `tests/commands/smart-compact.test.ts`, ensure there is an explicit test proving that when selected lower-band output is missing or failed, generated output does NOT substitute deterministic placeholder text. The test should assert the absence of placeholder-style output, not just the presence of an error.

**Affected TCs:** AC-4.4, TC-4.4a

### Verification

After these changes, `npm run verify` and `npm run verify-all` must both still pass.
