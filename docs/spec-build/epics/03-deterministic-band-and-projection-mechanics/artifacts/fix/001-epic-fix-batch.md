# Epic Fix Batch — Round 1

## EV-03-001: Zero-percent smooth allocations still emit smooth-band content

- Fix `ThreadViewMaterializer` to respect an explicitly empty smooth selection from the builder. When the builder returns zero smooth-band turn selections (because the operator allocated 0% to smooth), the materializer must not repopulate the smooth band from the full-fidelity boundary.
- The distinction: an empty smooth selection because the operator chose `smooth: 0` is different from a missing smooth selection because no smooth data exists. The materializer's legacy defaulting behavior applies only to the latter case (pre-Feature 3 views). Feature 3 deterministic rebuilds should carry an explicit "operator selected zero" signal that the materializer respects.
- After the fix, `buildDraftThreadView()` with `requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 }` must produce a draft with an empty smooth band, and `runSmartCompact()` with those same percentages must produce a PI session file with zero smooth_turn entries.

## EV-03-002: Add regression test for zero-smooth smart compact

- Add a test in `tests/thread-view/thread-view-builder.test.ts` (or the materializer test) that exercises a `100/0/0/0` rebuild and asserts the smooth band in the rebuilt draft view is empty.
- Add a test in `tests/commands/smart-compact.test.ts` that exercises `runSmartCompact()` with `100/0/0/0` percentages and asserts the generated PI session file contains zero smooth_turn entries.
