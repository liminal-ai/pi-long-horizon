# Story 0: Foundation

### Summary
<!-- Jira: Summary field -->

Establish the shared Context Steward domain vocabulary, error/result helpers, id utilities, verification scripts, and test scaffolding used by all Session Context Store stories.

### Description
<!-- Jira: Description field -->

**User Profile**

**Primary User:** Context Steward

**Context:** The steward runs beside the PI CLI during coding sessions. It records finalized PI runtime activity, stores it in the source Thread, groups it into prompt-bounded turns, and keeps target metadata for the generated PI session file.

**Mental Model:** "Keep the full source thread complete, ordered, and repairable before any smoothing, chunking, summary, or projection work uses it."

**Key Constraint:** PI exposes runtime activity through extension and session surfaces, while the long-horizon context substrate must remain target-neutral and complete enough to regenerate derived state.

**Secondary Users:** The human operator starts PI, attaches existing sessions, runs repair/import commands, and dogfoods stored context behavior. PI consumes the generated PI session file tracked by the source thread.

**Objective**

Create the foundation files and test harness needed before feature behavior is implemented.

**In Scope**

- Canonical domain record names and shared constants.
- Shared error codes and `StewardResult`/issue helpers.
- ID, target key, source range, and content fingerprint helpers.
- Test fixture builders and temp store helpers.
- Package scripts for typecheck/test/verify flows.

**Out of Scope**

- Thread persistence behavior.
- Live PI capture behavior.
- Turn lifecycle behavior.
- Attach/import, repair, generated-session metadata, and fixture creation behavior.

**Dependencies**

- PRD, technical architecture, epic, tech design, and test plan accepted.

### Acceptance Criteria
<!-- Jira: Acceptance Criteria field -->

Story 0 has no user-facing ACs from the epic. It creates shared infrastructure required by Stories 1-7.

Required non-TC tests from [test-plan.md](../test-plan.md):

- **NTC-1:** `foundation.test.ts` - id and content fingerprint helpers are deterministic
- **NTC-2:** `foundation.test.ts` - schema-version constants match thread initialization

### Technical Design
<!-- Jira: Technical Notes or sub-section of Description -->

#### Architecture Context

Story 0 exists to make the later stories smaller and safer, not to smuggle feature behavior in through "shared helpers." It owns the canonical vocabulary, error/result surface, target-key derivation helpers, fixture builders, temp-store scaffolding, and verification script contract that every other story will consume.

The most important boundary here is restraint. Foundation should give later stories deterministic helpers and stable contracts, but it should not start implementing thread persistence, capture, turn lifecycle, import, repair, or fixture behavior early. If we let runtime behavior leak into this story, Story 1 and beyond will lose clean seams and the tests will stop telling us where behavior really lives.

#### Implementation Targets

| Area | Files / Modules |
|---|---|
| Domain vocabulary | `src/context-steward/domain/records.ts` |
| Error and result helpers | `src/context-steward/domain/errors.ts` |
| Id, target-key, and range helpers | `src/context-steward/domain/ids.ts` |
| Test scaffolding | `src/context-steward/test/fixtures.ts`, `src/context-steward/test/temp-store.ts` |
| Verification scripts | `package.json` |

#### Design References

- [tech-design.md §Error Contract](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:133), lines 133-176
- [tech-design.md §Record Schemas](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:292), lines 292-452
- [tech-design.md §Store Interface](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:503), lines 503-655
- [tech-design.md §Verification Scripts](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1123), lines 1123-1142
- [tech-design.md §Chunk 0: Foundation](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/tech-design.md:1156), lines 1156-1166
- [test-plan.md §Non-TC Decided Tests](/Users/leemoore/code/pi-long-horizon/docs/spec-build/epics/session-context-store/test-plan.md:187), lines 187-205

#### Test Mapping

None. Story 0 owns no epic AC/TCs.

#### Non-TC Decided Tests

- `tests/context-steward/foundation.test.ts`: NTC-1 deterministic id, target-key, and content fingerprint helpers
- `tests/context-steward/foundation.test.ts`: NTC-2 schema-version constants and shared defaults match Thread initialization

#### Technical Notes

- Keep foundation modules pure and target-neutral so later stories can reuse them without hidden filesystem or PI runtime state.
- `deriveTargetSessionKeys(...)` belongs here because every story that touches association logic must use the same canonical key and alias rules.
- Story 0 owns adding the documented repo-level verification commands from the tech design: `test`, `verify`, `green-verify`, and `verify-all`.
- Add verification scripts here, but do not hide runtime behavior in script helpers or test scaffolding.

#### Anti-Shim Requirements

- Prove helper behavior through direct tests of exported functions and constants.
- Do not implement thread-store, capture, turn, import, repair, or fixture behavior in foundation files just because downstream stories need the types.

#### Verification

- Targeted: `npm run typecheck`
- Story gate: `npm run verify`
- Epic gate: `npm run verify-all`

#### Spec Deviations

None.

### Definition of Done
<!-- Jira: Definition of Done or Acceptance Criteria footer -->

- Domain constants and shared helper modules exist.
- Error/result helpers expose all epic error codes.
- Test fixture builders and temp store helpers are available to downstream stories.
- Verification scripts are added or documented for implementation.
- `foundation.test.ts` covers deterministic ids/fingerprints and schema constants.
- No feature story behavior is implemented in this story beyond shared scaffolding.
