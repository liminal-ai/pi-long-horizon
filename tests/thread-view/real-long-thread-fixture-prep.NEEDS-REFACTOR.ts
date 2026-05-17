import test from "node:test";

/*
NEEDS-REFACTOR

This file intentionally remains in the repository but is removed from the active
test runners by filename. The previous version of this test executed a full
clone-and-prepare pass over the real long thread fixture and then asserted that
the prepared clone materialized cleanly under current assumptions.

Why this is quarantined:
- It is an in-process test, not a real end-to-end PI execution test.
- It was taking roughly 60 seconds by itself, which makes it a bad fit for the
  fast service-layer feedback loop.
- It is also not a true E2E because it never spawns the real `pi` binary or
  exercises the real outer runtime surface.
- The important behavior it was trying to prove is now covered more appropriately
  by:
  1. smaller service/in-process tests for smooth repair, chunk refresh, placeholder
     freshness, and thread-view materialization semantics, and
  2. the real PI execution E2E tests that consume the prepared long-thread fixture.

High-level recommendation for the next epic:
- Keep the prep helper and script as reusable infrastructure.
- Decompose any remaining unique assertions from the old giant test into smaller,
  focused service tests where they are genuinely cheap and high signal.
- Let the real PI execution E2E tests remain the proof that the prepared fixture
  works in actual runtime usage.
- Do not restore this as a heavyweight standalone in-process test unless its
  runtime and conceptual role are fundamentally changed.
*/

test.skip("NEEDS-REFACTOR: heavyweight prepared long-thread fixture proof", () => {});
