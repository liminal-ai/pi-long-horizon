# Coverage Artifact: Epic 5 — Real Lower-Band Compression

## Coverage Gate

Every AC and TC from the detailed epic mapped to exactly one story.

| AC | TC(s) | Story |
|----|-------|-------|
| AC-1.1 | TC-1.1a, TC-1.1b | Story 1 |
| AC-1.2 | TC-1.2a, TC-1.2b, TC-1.2c | Story 1 |
| AC-1.3 | TC-1.3a, TC-1.3b | Story 1 |
| AC-1.4 | TC-1.4a, TC-1.4b | Story 1 |
| AC-1.5 | TC-1.5a | Story 1 |
| AC-1.6 | TC-1.6a, TC-1.6b, TC-1.6c, TC-1.6d, TC-1.6e | Story 1 |
| AC-1.7 | TC-1.7a, TC-1.7b | Story 1 |
| AC-2.1 | TC-2.1a, TC-2.1b | Story 2 |
| AC-2.2 | TC-2.2a, TC-2.2b, TC-2.2c, TC-2.2d | Story 1 |
| AC-2.3 | TC-2.3a, TC-2.3b, TC-2.3c | Story 2 |
| AC-2.4 | TC-2.4a, TC-2.4b | Story 2 |
| AC-2.5 | TC-2.5a, TC-2.5b | Story 2 |
| AC-2.6 | TC-2.6a, TC-2.6b, TC-2.6c | Story 2 |
| AC-3.1 | TC-3.1a, TC-3.1b | Story 3 |
| AC-3.2 | TC-3.2a, TC-3.2b, TC-3.2c, TC-3.2d | Story 3 |
| AC-3.3 | TC-3.3a, TC-3.3b, TC-3.3c | Story 3 |
| AC-3.4 | TC-3.4a, TC-3.4b | Story 4 |
| AC-3.5 | TC-3.5a, TC-3.5b | Story 4 |
| AC-3.6 | TC-3.6a, TC-3.6b, TC-3.6c | Story 4 |
| AC-3.7 | TC-3.7a, TC-3.7b, TC-3.7c | Story 4 |
| AC-3.8 | TC-3.8a, TC-3.8b | Story 3 |
| AC-4.1 | TC-4.1a, TC-4.1b | Story 5 |
| AC-4.2 | TC-4.2a, TC-4.2b | Story 5 |
| AC-4.3 | TC-4.3a, TC-4.3b | Story 5 |
| AC-4.4 | TC-4.4a, TC-4.4b | Story 6 |
| AC-4.5 | TC-4.5a, TC-4.5b | Story 6 |
| AC-5.1 | TC-5.1a, TC-5.1b | Story 7 |
| AC-5.2 | TC-5.2a, TC-5.2b | Story 7 |
| AC-5.3 | TC-5.3a, TC-5.3b | Story 7 |
| AC-5.4 | TC-5.4a, TC-5.4b | Story 7 |
| AC-6.1 | TC-6.1a, TC-6.1b | Story 0 |
| AC-6.2 | TC-6.2a, TC-6.2b | Story 3 |
| AC-6.3 | TC-6.3a, TC-6.3b | Story 3 |
| AC-6.4 | TC-6.4a, TC-6.4b, TC-6.4c | Story 0 |

**Totals:** 33 ACs, 81 TCs. All assigned. No orphans. No duplicates.

---

## Integration Path Trace

The critical end-to-end user path for Epic 5 is: a coding session grows, older Turns are smoothed, Chunks form from conversation-only projections, lower-band compression produces detailed/brief output, and smart compact validates readiness before building the runtime projection. The generated PI session write and reload behavior is inherited from prior epics and not newly TC-owned here.

Epic 5 also adds explicit E2E architecture-risk coverage where service-tier
tests are not enough. Story 5 extends the real long-thread PI runtime E2E to
prove smart compact can consume semantic lower-band output and PI can continue
after generated rollout reload. Story 6 adds placeholder-free generated rollout
assertions to that same E2E path. Story 7 adds a narrow operator command-surface
E2E for lower-band inspection reachability. These checks do not move AC/TC
ownership; they protect runtime confidence across the outer surfaces.

### Path 1: Normal Lower-Band Lifecycle (Happy Path)

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Turn closes with smooth components | Smooth component state available for closed Turn | Story 1 | TC-1.1a |
| Conversation-only projection materialized | `>` / `●` text derived from smooth components | Story 1 | TC-1.2a, TC-1.2c |
| Exact boundary token count persisted | Proper count stored for Chunk decisions | Story 1 | TC-2.2a |
| Chunk evaluates Turn for append/close | Boundary decision uses projection count | Story 2 | TC-2.1a |
| Chunk transcript assembled | Conversation-only text concatenated in Turn order | Story 2 | TC-2.3a |
| Chunk closes, async generation scheduled | Detailed/brief generation triggered without blocking | Story 3 | TC-3.1a, TC-3.1b |
| Detailed output generated | GPT OAuth produces detailed semantic text | Story 3 | TC-3.2a |
| Brief output generated | GPT OAuth produces brief semantic text | Story 3 | TC-3.2b |
| Size check passes or retries | Output within range or retry/escalate | Story 4 | TC-3.4a, TC-3.5a, TC-3.6b |
| Lean artifact stored | Ready status + final text, no metadata bloat | Story 4 | TC-3.7a |
| Smart compact selects Chunk for lower band | Readiness validated for selected Chunk | Story 5 | TC-4.1a, TC-4.1b |
| Readiness-gated runtime projection build | `buildThreadViewProjection` proceeds only after selected lower-band readiness is confirmed | Story 5 | TC-4.1a, TC-4.1b |

### Path 2: Missing Lower-Band Output — Catch-Up And Failure

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Smart compact selects Chunk | Selected Chunk is missing required detailed/brief output | Story 5 | TC-4.2a |
| Catch-up generation triggered | Synchronous generation attempted for missing band | Story 5 | TC-4.2a |
| Catch-up warning emitted | Stderr warning identifies Chunk and band | Story 5 | TC-4.2b |
| Catch-up succeeds | Output becomes ready, compact continues | Story 5 | TC-4.2a |
| Catch-up fails | Compact fails with specific error identifying Chunk/band | Story 5 | TC-4.3a, TC-4.3b |
| No placeholder fallback | Failed state does not trigger placeholder generation | Story 6 | TC-4.4a |

### Path 3: Legacy State Blocking

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Thread contains legacy placeholder-era Chunks | Old Chunks present from before Epic 5 | Story 2 | TC-2.6b |
| Legacy Chunk blocked from lower-band selection | Placeholder-era state never satisfies lower-band readiness | Story 6 | TC-4.4b, TC-4.5a |
| Placeholder generator unreachable at runtime | Normal compact path cannot invoke placeholder generation | Story 6 | TC-4.5a |
| Operator can distinguish new from old state | New schema version vs. legacy state is explicit | Story 2 | TC-2.6c |

---

## Validation Summary

- [x] Every AC from the detailed epic appears in a story file (33/33)
- [x] Every TC from the detailed epic appears in exactly one story file (81/81)
- [x] Coverage artifact persisted with both tables
- [x] Integration path trace complete with no gaps
- [x] Coverage gate table complete with no orphans
- [x] Each story file has Jira section markers
- [x] Story files are numbered and named consistently
