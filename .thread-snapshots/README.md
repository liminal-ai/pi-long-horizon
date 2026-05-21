# Thread Snapshots

This directory stores heavyweight thread-state snapshots for PI Long Horizon experiments.

Each snapshot archive is a zip of the thread directory exactly as captured under:

`.context-steward/threads/<threadId>/`

Restore approach:

1. From the project root, unzip the archive over the repo root.
2. This restores the thread directory, including canonical store files and generated session files.
3. If PI should reopen the restored generated session directly, start PI against the restored generated JSONL referenced in the snapshot metadata below.

## Catalog

### 2026-05-19T21:42:31Z - `thread_df67cbe0-2c0d-4c6e-90fa-570b04cd9bcc`

- Archive:
  `.thread-snapshots/2026-05-19T21-42-31Z-thread_df67cbe0-src463-full-thread-snapshot.zip`
- Metadata:
  `.thread-snapshots/2026-05-19T21-42-31Z-thread_df67cbe0-src463-full-thread-snapshot.json`
- Thread source revision: `463`
- Turns revision: `372`
- Turn count: `52`
- Canonical message count: `463`
- Current active generated session file:
  `/Users/leemoore/code/pi-long-horizon/.context-steward/threads/thread_df67cbe0-2c0d-4c6e-90fa-570b04cd9bcc/generated/projection_98a763de-8491-4572-a18f-6b64108b1596-thread_view_f31f8006-0bb6-43a0-a0dd-08cdf56a8761.jsonl`
- Current projected thread-view token count as PI sees it: `165391`
- Canonical whole-thread token estimate with no smart compact, smoothing, or tool-result pruning: `834676`

Notes:

- Smart compact has been run once on this thread.
- That first compact produced upper-band output only:
  `15` turns in `full_fidelity`, `10` turns in `smooth`, `0` selected `detailed`, `0` selected `brief`.
- Many verbose turns were added after that compact.
- Those post-compact turns remain in the active full-fidelity region and are subject to normal prompt-visible tool-result pruning once the live raw zone crosses the `32k` threshold.
- Expected next compact behavior:
  it should populate the `detailed` band, and it may populate the `brief` band as well, though that part is not yet confirmed.
## 2026-05-20T01:41:09.185Z — post-second-smart-compact-heavy-full-fidelity-growth

- Archive: `2026-05-20T01-41-09-185Z-thread_df67cbe0-2c0d-src831-full-thread-snapshot.zip`
- Metadata: `2026-05-20T01-41-09-185Z-thread_df67cbe0-2c0d-src831-full-thread-snapshot.json`
- Thread: `thread_df67cbe0-2c0d-4c6e-90fa-570b04cd9bcc`
- Source revision: `831`
- Message high watermark: `831`
- Active generated thread-view: `projection_0dd9a3fc-b582-424f-8ec0-0cfeb03112d1-thread_view_b7a83ce1-2021-4362-b86e-8f55f29176f8.jsonl`
- PI/provider reported active context tokens: **216,942** (79.8% of 272k)
- Canonical raw estimate, no smoothing/compression/pruning: **1,032,703 tokens** (3,819,517 chars)
- Tool-result portion of canonical raw estimate: **734,512 tokens** (2,717,083 chars)
- Turns: **101** total / **100** closed / **1** open
- Messages: **831** total — prompts 101, assistant responses 381, tool results 349
- Chunks: **27** total / **26** closed / **1** open
- Lower-band projections: {"provider_input_count/exact":100,"missing":1}
- Raw turn materialized counts: {"provider_input_count/exact":52,"pi_heuristic/heuristic_estimate":48,"missing":1}
- Smooth turn materialized counts: {"provider_input_count/exact":52,"pi_heuristic/heuristic_estimate":48,"missing":1}

Summary: this snapshot captures the session after substantial additional verbose work following earlier smart compacts. The active projected thread-view is large but still under the 272k context limit through smoothing, compaction, and prompt-visible tool-result pruning. The canonical source remains much larger and full-fidelity. The thread now has 101 turns and 831 messages, with canonical raw estimated at about 1.03M tokens and tool results accounting for about 734k of that estimate. This is a good restore point before further smart-compact experiments likely intended to push detailed/brief bands harder.


## 2026-05-20T23:43:08.500Z — pre-smart-compact after repair-command design/review work

- Archive: `2026-05-20T23-43-08-500Z-df67cbe0-2c0d-src1591-pre-smart-compact-snapshot.zip`
- Metadata: `2026-05-20T23-43-08-500Z-df67cbe0-2c0d-src1591-pre-smart-compact-snapshot.json`
- Thread: `thread_df67cbe0-2c0d-4c6e-90fa-570b04cd9bcc`
- Capture point: **pre-smart-compact**. This snapshot was taken before running the next requested `/lh-smart-compact --lower-bound 160000 ... --mode prepare`.
- Source revision: `1591`
- Turns revision: `1784`
- Message high watermark: `1591`
- Active generated thread-view from previous compact:
  `projection_4642e567-fce3-4816-bebb-808eabc0956b-thread_view_4aaed88f-52fd-4569-8bb7-c069bd55850b.jsonl`
- Previous generated session token count: **81,001** provider exact (`provider_input_count/exact`), source revision `1064`
- Canonical raw visible-text estimate: **1,420,071 tokens**
- Canonical tool-result raw estimate: **1,003,515 tokens**
- Messages: **1,589** total — prompts 261, assistant responses 752, tool results 576
- Turns: **261** total / **261** closed / **0** open
- Chunks: **62** total / **61** closed / **1** open
- Status: no degraded status; token counting still `repair_needed` with the known `exact_token_count_repair_skipped` issue from prior async maintenance behavior.

### Current band state before the next compact

These counts describe the currently loaded generated projection plus live turns added afterward. The generated projection itself is still the previous smart-compact output from source revision `1064`; turns after that are live post-compact tail and have not yet been reshuffled into a new projection.

Generated projection band layout from last compact:

- `full_fidelity`: **11 turns** — turn indices **146–156**, token sum metadata **14,030**
- `smooth`: **110 turns** — turn indices **36–145**, token sum metadata **71,757**
- `detailed`: **9 chunks** — `chunk-001` through `chunk-009`, covering **35 turns**, token sum metadata **5,160**
- `brief`: **0 chunks / 0 turns**, token sum metadata **0**

Live post-compact tail:

- **105 turns** — turn indices **157–261**
- These turns were added after the previous generated projection source revision and are effectively still in the active live/full-fidelity tail before the next smart compact.
- Approximate effective current full-fidelity turn count before the next compact: **116 turns** (`11` generated full-fidelity turns + `105` live post-compact tail turns).

### Token metadata rollups at snapshot time

- Raw turn materialized counts:
  - `provider_input_count/exact`: 156 records / 502,004 tokens
  - `pi_heuristic/heuristic_estimate`: 105 records / 165,896 tokens
- Smooth turn materialized counts:
  - `provider_input_count/exact`: 156 records / 94,114 tokens
  - `pi_heuristic/heuristic_estimate`: 105 records / 39,527 tokens
- Lower-band turn projections:
  - `provider_input_count/exact`: 261 records / 107,849 tokens
- Chunk smooth counts:
  - `provider_input_count/exact`: 43 records / 91,121 tokens
  - `pi_heuristic/heuristic_estimate`: 19 records / 41,840 tokens
- Detailed chunk artifacts:
  - `provider_input_count/exact`: 61 records / 36,041 tokens
- Brief chunk artifacts:
  - `provider_input_count/exact`: 61 records / 14,993 tokens

### Where we are in the work

This snapshot captures the project after the first `lh-context` SDK/CLI slice and Beads backlog migration, after fixing async exact token repair, and during review/design of the standalone thread maintenance/repair command (`pi-long-horizon-2cz`). The repair-command implementation looked directionally useful, but full E2E review exposed that automatic PI `turn_end` maintenance can still do too much broad historical repair work on long threads. The current design direction is to split behavior clearly:

- automatic `turn_end` maintenance should remain every-turn but bounded/opportunistic;
- manual `repairThreadMaintenance` / future CLI repair should be allowed to perform full catch-up repair with a report;
- full catch-up behavior should not run implicitly in the production PI extension path.

This is a good pre-compact restore point for comparing how the next smart compact reshapes the large live tail into smooth/detailed/brief bands.
