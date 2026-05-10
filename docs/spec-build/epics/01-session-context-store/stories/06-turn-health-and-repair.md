# Story 6: Turn Health And Repair

### Summary
<!-- Jira: Summary field -->

Detect missing or incomplete Turn state, reconstruct prompt-bounded Turn membership from stored Messages, and keep downstream maintenance blocked until Turn state is valid.

### Description
<!-- Jira: Description field -->

**User Profile**

**Primary User:** Context Steward

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized PI runtime activity, stores it in the source Thread, groups it into prompt-bounded turns, and keeps target metadata for the generated PI session file.

**Mental Model:** "Keep the full source thread complete, ordered, and repairable before any smoothing, chunking, summary, or projection work uses it."

**Key Constraint:** PI exposes runtime activity through extension and session surfaces, while the long-horizon context substrate must remain target-neutral and complete enough to regenerate derived state.

**Secondary Users:** The human operator starts PI, attaches existing sessions, runs repair/import commands, and dogfoods stored context behavior. PI consumes the generated PI session file tracked by the source thread.

**Objective**

Make Turn state repairable from immutable Messages and make incomplete Turn state visible before downstream maintenance uses it.

**In Scope**

- Detect missing and incomplete Turn state.
- Reconstruct Turn membership from stored Messages using agent-addressed prompt boundaries.
- Preserve message order and content during repair.
- Report downstream readiness blockers.
- Report ambiguous boundaries, write failures, and stale source input.

**Out of Scope**

- Smoothing, chunking, summarization, and smart compact.
- Full Context Navigator views.
- Import-specific reconstruction behavior covered by Story 5.

**Dependencies**

- Story 3 complete.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

**AC-6.1:** The steward can detect missing or incomplete Turn state for stored messages.

- **TC-6.1a: Missing turn state detected**
  - Given: A Thread has stored messages and no Turn records
  - When: Turn health is checked
  - Then: The steward reports missing Turn state for the affected message range
- **TC-6.1b: Incomplete turn membership detected**
  - Given: A Thread has stored messages that are not covered by existing Turn membership
  - When: Turn health is checked
  - Then: The steward reports incomplete Turn state and identifies the uncovered message range
- **TC-6.1c: Healthy turn state passes**
  - Given: All stored messages that belong to Turns are covered by valid Turn membership
  - When: Turn health is checked
  - Then: The steward reports Turn state as ready for later maintenance

**AC-6.2:** Repair reconstructs Turn membership from stored messages using agent-addressed prompt boundaries.

- **TC-6.2a: Repair creates turns from prompts**
  - Given: A Thread has stored messages with agent-addressed prompts and missing Turn state
  - When: Repair runs
  - Then: The steward creates Turn records using each agent-addressed prompt as a Turn boundary
- **TC-6.2b: Repair assigns between-boundary messages**
  - Given: Stored messages appear between two agent-addressed prompts
  - When: Repair runs
  - Then: The messages are assigned to the Turn started by the first prompt
- **TC-6.2c: Repair preserves final open turn**
  - Given: The last agent-addressed prompt has no later initiating prompt
  - When: Repair runs
  - Then: The final Turn is marked open

**AC-6.3:** Repair preserves message order and raw message content.

- **TC-6.3a: Message order preserved**
  - Given: A Thread has stored messages in source order
  - When: Repair runs
  - Then: The messages retain the same source order after repair
- **TC-6.3b: Message content preserved**
  - Given: A Thread has stored messages before repair
  - When: Repair runs
  - Then: Message content, parts, actor identity, message kind, timestamps, and target metadata remain unchanged

**AC-6.4:** Missing or incomplete Turn state is reported before smoothing, chunking, or smart compact uses affected Turns.

- **TC-6.4a: Missing turn state blocks downstream readiness**
  - Given: A Thread has messages with missing Turn state
  - When: Maintenance readiness is checked for smoothing, chunking, or smart compact
  - Then: The steward reports blocked readiness and names missing Turn state as the blocker
- **TC-6.4b: Incomplete turn state blocks downstream readiness**
  - Given: A Thread has incomplete Turn membership
  - When: Maintenance readiness is checked for smoothing, chunking, or smart compact
  - Then: The steward reports blocked readiness and identifies the affected message range
- **TC-6.4c: Repaired turn state clears blocker**
  - Given: Turn repair has reconstructed valid Turn membership for affected messages
  - When: Maintenance readiness is checked
  - Then: Turn state is no longer reported as a blocker for those messages

**AC-6.5:** Repair failures are visible and do not produce partially trusted Turn state.

- **TC-6.5a: Ambiguous prompt boundary reported**
  - Given: Stored messages contain activity whose initiating prompt status cannot be determined
  - When: Repair runs
  - Then: The steward reports the ambiguous message range and does not mark the affected Turn state ready
- **TC-6.5b: Repair write failure reported**
  - Given: Repair reconstructs Turn membership
  - When: The steward cannot write repaired Turn state
  - Then: The steward reports repair failure and leaves readiness blocked for the affected range
- **TC-6.5c: Repair detects source changes during repair**
  - Given: Repair starts from a Thread source range
  - When: New messages are captured in that range before repair writes Turn state
  - Then: The steward reports stale repair input and does not mark the affected Turn state ready from the stale repair result

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 6 is the safety net that makes immutable source history usable when turn state is missing, incomplete, or stale. It owns health reporting, repair orchestration, and the explicit blocked-state behavior that later smoothing, chunking, and smart compact will depend on before they trust Turn data.

This story should not invent a second set of turn-boundary rules. Story 3 already defines how prompts, responses, tool activity, and pre-turn records are grouped. Repair must reuse that same prompt-boundary logic against stored Messages, then apply optimistic source-revision guards so stale repair input never gets mistaken for current truth.

#### Implementation Targets

| Owned Targets | Files / Modules |
|---|---|
| Health checks and prompt-boundary helpers | `src/context-steward/services/turn-service.ts` |
| Repair orchestration and stale-source guards | `src/context-steward/services/repair-service.ts` |
| Primary tests | `tests/context-steward/repair-service.test.ts` |

| Integration Touchpoints | Files / Modules |
|---|---|
| Turn snapshot persistence contract from Story 1 | `src/context-steward/store/thread-store.ts` |
| Operator command surface | `src/context-steward/pi/pi-extension.ts` |

#### Design References

- [tech-design.md §Architecture Decisions](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:188), lines 188-205
- [tech-design.md §Store Interface](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:503), lines 503-655
- [tech-design.md §Flow 5: Turn Health and Repair](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:838), lines 838-881
- [tech-design.md §Core Services](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:923), lines 923-1064
- [tech-design.md §Chunk 4: Turn Health and Repair](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1210), lines 1210-1223
- [test-plan.md `repair-service.test.ts`](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:138), lines 138-158
- [test-plan.md §Command Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:175), lines 175-185

#### Test Mapping

| TC | Test File / Check | Test Description |
|---|---|---|
| TC-6.1a, TC-6.1b, TC-6.1c | `tests/context-steward/repair-service.test.ts` | detect missing turn state, incomplete membership, and healthy ready state |
| TC-6.2a, TC-6.2b, TC-6.2c | `tests/context-steward/repair-service.test.ts` | reconstruct prompt-bounded turn membership from stored messages and preserve final open turn |
| TC-6.3a, TC-6.3b | `tests/context-steward/repair-service.test.ts` | preserve source order and message content during repair |
| TC-6.4a, TC-6.4b, TC-6.4c | `tests/context-steward/repair-service.test.ts` | block downstream readiness on bad turn state and clear the blocker after successful repair |
| TC-6.5a, TC-6.5b, TC-6.5c | `tests/context-steward/repair-service.test.ts` | surface ambiguous boundaries, write failures, and stale source input without trusting partial repair |

#### Non-TC Decided Tests

- `tests/context-steward/repair-service.test.ts`: NTC-10 range-limited repair does not rewrite unaffected turns
- `tests/context-steward/repair-service.test.ts`: NTC-11 health report ranges are sorted by source order

#### Technical Notes

- Reuse Story 3's prompt-boundary rule. Repair should not have a second heuristic for deciding which messages belong to a turn.
- The tech design defines `STALE_SOURCE_REVISION` as the internal code for stale repair input. The epic-level behavior for this story remains TC-6.5c: source changed during repair, readiness stays blocked, and stale output is not trusted.
- Later maintenance consumers will read only the health/readiness contract, not the repair internals, so keep the blocked/ready state transitions explicit and conservative.
- Command-output coverage for `/lh-turn-health` and `/lh-repair-turns` is centralized in Story 7's command-surface non-TC tests so repair behavior stays owned here and formatting behavior stays in one story.

#### Anti-Shim Requirements

- Run repair against real stored Messages and source revisions, not mocked turn arrays or hand-waved snapshot objects.
- Assert that ambiguous, write-failure, and stale-source paths leave readiness blocked after the repair attempt rather than only checking for thrown errors.

#### Verification

- Targeted: `npm run verify`
- Story gate: `npm run green-verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- Turn health identifies missing, incomplete, and ready states.
- Repair reconstructs prompt-bounded Turn membership from stored Messages.
- Repair preserves message content and source order.
- Maintenance readiness reports blockers until Turn state is valid.
- Ambiguous boundaries, write failures, and stale source input leave affected state blocked.
- `repair-service.test.ts` covers all TCs assigned to this story.
