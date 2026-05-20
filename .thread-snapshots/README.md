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

