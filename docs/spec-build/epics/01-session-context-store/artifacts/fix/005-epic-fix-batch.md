# Epic Fix Batch 3

Source: epic reverify artifact `artifacts/epic/005-epic-reverify.json`

## Approved Fixes

- APPROVED: Thread creation timing — `resolveCaptureThread()` in `src/context-steward/pi/pi-extension.ts:611-645` currently only creates a new managed thread on `message_end` for unmanaged sessions. Per AC-1.1/TC-1.1a (epic.md:87-109, tech-design.md:664-683), a managed thread should exist when capture starts on `session_start`. Fix `resolveCaptureThread()` or the `session_start` handler so that a brand-new session gets a managed thread created on `session_start`, not deferred to the first `message_end`. This should not re-introduce the CAN-001 auto-management problem for pre-populated sessions — only create a thread on `session_start` when no prior history exists and no managed thread already exists for that target.

- APPROVED: Command-surface test coverage — `tests/context-steward/pi-extension-commands.test.ts` currently only covers formatter behavior, fixture flows, two `/lh-attach` happy paths, and `/lh-status` with no managed thread. The test plan at `docs/spec-build/epics/01-session-context-store/test-plan.md:181-185` expects command coverage for `/lh-attach` success and conflict summaries, `/lh-turn-health` ready and blocked states, `/lh-repair-turns` repair success and stale-source failure, `/lh-fixture` created fixture id and failure code, and `/lh-status` with active thread state. Add the missing command-surface test cases.
