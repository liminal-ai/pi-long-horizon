# Coverage Artifact: Epic 3 — Deterministic Band And Projection Mechanics

## Coverage Gate

Every AC and TC from the detailed epic mapped to exactly one story.

| AC | TC | Story |
|----|-----|-------|
| AC-1.1 | TC-1.1a, TC-1.1b | Story 1 |
| AC-1.2 | TC-1.2a, TC-1.2b | Story 1 |
| AC-1.3 | TC-1.3a, TC-1.3b | Story 1 |
| AC-1.4 | TC-1.4a, TC-1.4b | Story 1 |
| AC-2.1 | TC-2.1a, TC-2.1b | Story 2 |
| AC-2.2 | TC-2.2a, TC-2.2b | Story 2 |
| AC-2.3 | TC-2.3a, TC-2.3b | Story 2 |
| AC-2.4 | TC-2.4a, TC-2.4b, TC-2.4c | Story 2 |
| AC-2.5 | TC-2.5a, TC-2.5b | Story 2 |
| AC-3.1 | TC-3.1a, TC-3.1b | Story 3 |
| AC-3.2 | TC-3.2a, TC-3.2b | Story 3 |
| AC-3.3 | TC-3.3a, TC-3.3b | Story 3 |
| AC-3.4 | TC-3.4a, TC-3.4b | Story 3 |
| AC-4.1 | TC-4.1a, TC-4.1b | Story 4 |
| AC-4.2 | TC-4.2a, TC-4.2b, TC-4.2c | Story 4 |
| AC-4.3 | TC-4.3a, TC-4.3b | Story 4 |
| AC-4.4 | TC-4.4a, TC-4.4b, TC-4.4c | Story 4 |
| AC-4.5 | TC-4.5a, TC-4.5b | Story 4 |
| AC-4.6 | TC-4.6a, TC-4.6b, TC-4.6c | Story 4 |
| AC-5.1 | TC-5.1a, TC-5.1b, TC-5.1c, TC-5.1d, TC-5.1e | Story 5 |
| AC-5.2 | TC-5.2a, TC-5.2b | Story 5 |
| AC-5.3 | TC-5.3a, TC-5.3b | Story 5 |
| AC-5.4 | TC-5.4a, TC-5.4b | Story 5 |
| AC-5.5 | TC-5.5a, TC-5.5b | Story 5 |
| AC-5.6 | TC-5.6a, TC-5.6b | Story 5 |
| AC-6.1 | TC-6.1a, TC-6.1b | Story 6 |
| AC-6.2 | TC-6.2a, TC-6.2b | Story 6 |
| AC-6.3 | TC-6.3a, TC-6.3b | Story 6 |
| AC-6.4 | TC-6.4a, TC-6.4b | Story 6 |
| AC-6.5 | TC-6.5a, TC-6.5b | Story 6 |

**Total: 31 ACs, 67 TCs. All assigned to exactly one story. No orphans.**

## Integration Path Trace

### Path 1: Full Deterministic Maintenance Loop (New Session → Smart Compact → PI Reload)

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Closed Turn available | Closed Turn is available for deterministic smoothing | Story 1 | TC-1.1a |
| Smooth-turn generation | Closed Turn receives deterministic smooth text | Story 1 | TC-1.1a, TC-1.2a |
| Chunk eligibility | Closed smoothed Turn becomes chunk-eligible | Story 2 | TC-2.1b |
| Chunk append | Eligible Turn joins open Chunk | Story 2 | TC-2.3a |
| Chunk closure | Open Chunk closes by threshold rule | Story 2 | TC-2.4b |
| Placeholder generation | Closed Chunk receives 30% and 5% placeholders | Story 3 | TC-3.1a, TC-3.2a |
| Band rebuild | Draft Thread View rebuilt from explicit run inputs | Story 4 | TC-4.1a, TC-4.2a |
| Materialization | Emitted message sequence produced across bands | Story 4 | TC-4.5a |
| Prerequisite check | Smart compact verifies smooth and placeholder readiness | Story 5 | TC-5.1c, TC-5.1d |
| PI-target write | Generated PI session file written atomically | Story 5 | TC-5.2a |
| Archive prior | Prior generated output archived | Story 5 | TC-5.3a |
| PI reload | PI loads new generated file | Story 5 | TC-5.4a |
| Source safety | Source Thread unchanged after compact | Story 5 | TC-5.5a |

### Path 2: Blocked Smart Compact (Missing Prerequisites)

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Missing smooth | Required smooth output not available | Story 1 | TC-1.4a |
| Blocked by smooth | Dependent chunk or rebuild work blocked | Story 6 | TC-6.1a |
| Missing placeholder | Required placeholder not available | Story 3 | TC-3.3b |
| Blocked by placeholder | Lower-band allocation blocked | Story 6 | TC-6.1b |
| Smart compact stops | Command stops with explicit blockers | Story 5 | TC-5.1c |
| Blocked state visible | Workbench shows blocked state | Story 6 | TC-6.4a |

### Path 3: Degraded Threshold Result

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Band rebuild | Draft Thread View rebuilt from explicit inputs | Story 4 | TC-4.1a |
| Full-fidelity overage | Raw Turns alone exceed lower bound | Story 4 | TC-4.2c |
| Threshold failure | Rebuild cannot reach requested lower bound | Story 4 | TC-4.6b |
| Degraded report | Result reports degraded threshold state | Story 6 | TC-6.3a |
| Compact stops | Smart compact does not claim silent success | Story 6 | TC-6.3b |

### Path 4: First-Time Bootstrap

| Path Segment | Description | Owning Story | Relevant TC |
|---|---|---|---|
| Fresh Thread | Thread has never been compacted | Story 5 | TC-5.1e |
| Bootstrap artifacts | Smart compact bootstraps missing smooth/chunk/placeholder work | Story 5 | TC-5.1e |
| First write | First generated output succeeds without archive | Story 5 | TC-5.3b |
| PI reload | PI loads first generated file | Story 5 | TC-5.4a |

**All path segments have story owners and TC coverage. No integration gaps.**
