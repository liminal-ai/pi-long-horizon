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

## 2026-05-23T19:40:56Z — current thread after 2cz close, before coder compact

- Archive: `2026-05-23T19-40-56Z-df67cbe0-2c0d-src1879-current-post-2cz-pre-coder-compact.zip`
- Metadata: `2026-05-23T19-40-56Z-df67cbe0-2c0d-src1879-current-post-2cz-pre-coder-compact.json`
- Thread: `thread_df67cbe0-2c0d-4c6e-90fa-570b04cd9bcc`
- Provided compact/session ID: `sc-df67cbe0-8244cf45-mper265s`
- Source revision: `1879`
- Message high watermark: `1879`
- Active generated thread-view:
  `.context-steward/threads/thread_df67cbe0-2c0d-4c6e-90fa-570b04cd9bcc/generated/projection_8244cf45-3f7b-49a3-9ca2-3f2e1cf612da-thread_view_96a5b154-64b8-408b-8525-df111f9092e9.jsonl`
- Generated session token count: **52,959** provider exact (`thread_view_output_summary.generatedSessionTokenCountMetadata`, source revision `1699`)
- Generated JSONL records/messages: **321 records / 317 messages**
- Latest assistant usage in generated JSONL: **98,862** tokens; authoritative generated count remains **52,959** from rollout metadata.
- Status: **degraded=0**, **repairNeeded=0**

### Canonical source stats at snapshot time

- Messages: **1,879** total — prompts **300**, assistant responses **895**, tool results **684**
- Turns: **300** total / **300** closed / **0** open
- Chunks: **69** total / **68** closed / **1** open
- Canonical visible-text raw estimate: **1,691,212 tokens** (`visible_text_chars_div_4`)
- Tool-result raw estimate: **1,242,501 tokens** (`visible_text_chars_div_4`)

### Current generated band layout

- `full_fidelity`: **26 entries**, **12 turns**, turn indices **274–285**, token sum **19,563**
- `smooth`: **56 entries**, **56 turns**, turn indices **218–273**, token sum **19,817**
- `detailed`: **33 entries**, **33 chunks** (`chunk-023` through `chunk-055`), token sum **19,603**
- `brief`: **22 entries**, **22 chunks** (`chunk-001` through `chunk-022`), token sum **5,457**

### Token metadata rollups

- Raw turn materialized counts: **300** provider exact records / **824,650** tokens
- Smooth turn materialized counts: **300** provider exact records / **149,908** tokens
- Lower-band turn projections: **300** provider exact records / **119,380** tokens
- Chunk smooth counts: **68** provider exact records / **146,308** tokens, plus **1** heuristic record / **2,092** tokens for the open/current chunk
- Detailed chunk artifacts: **68** provider exact records / **39,506** tokens
- Brief chunk artifacts: **68** provider exact records / **16,452** tokens

### Where we are

This snapshot captures the main long-horizon thread after the standalone thread maintenance/repair command work was committed and pushed (`95873e1`) and after the intermittent long-thread E2E race was split into follow-up bead `pi-long-horizon-kn7`. The active generated thread-view is healthy and compact: no degraded or repair-needed status, exact generated count around 53k, and all 300 turns have exact raw/smooth/lower-band token metadata. The main active work has shifted away from 2cz and toward the new intermittent async token-repair race bug plus the separate coder-session compact experiment.

## 2026-05-23T19:40:56Z — coder session before 80k smart compact

- Archive: `2026-05-23T19-40-56Z-717c9ea7-d2f4-src752-coder-pre-smart-compact.zip`
- Metadata: `2026-05-23T19-40-56Z-717c9ea7-d2f4-src752-coder-pre-smart-compact.json`
- Thread: `thread_717c9ea7-d2f4-4336-9b75-051b93878be7`
- Provided PI session ID: `019e4350-0555-7670-badb-5e1b794e26bf`
- Backing PI session file:
  `.pi/agent/sessions/--Users-leemoore-code-pi-long-horizon--/2026-05-20T02-56-18-261Z_019e4350-0555-7670-badb-5e1b794e26bf.jsonl`
- Source revision: `752`
- Message high watermark: `752`
- Generated thread-view: **none yet**
- Generated session token count: **unknown / n/a**
- Status: **degraded=0**, **repairNeeded=1** (`status.tokenCounting`, `exact_token_count_repair_skipped`)

### Canonical source stats at snapshot time

- Messages: **752** total — prompts **20**, assistant responses **365**, tool results **367**
- Turns: **20** total / **20** closed / **0** open
- Chunks: **5** total / **4** closed / **1** open
- Canonical visible-text raw estimate: **466,229 tokens** (`visible_text_chars_div_4`)
- Tool-result raw estimate: **381,039 tokens** (`visible_text_chars_div_4`)

### Current generated band layout

No generated thread-view exists for this coder thread yet, so all generated band counts are zero/unknown. This is intentionally a **pre-smart-compact** snapshot before running the requested coder smart compact with an 80k lower bound.

### Token metadata rollups

- Raw turn materialized counts: **20** heuristic records / **81,454** tokens
- Smooth turn materialized counts: **20** heuristic records / **14,632** tokens
- Lower-band turn projections: **20** provider exact records / **8,088** tokens
- Chunk smooth counts: **5** heuristic records / **14,634** tokens
- Detailed chunk artifacts: **4** provider exact records / **3,279** tokens
- Brief chunk artifacts: **4** provider exact records / **1,268** tokens

### Where we are

This snapshot captures the coder session immediately before the user plans to smart compact it to an 80k lower bound. The thread is relatively small in turn count but large in canonical raw/tool-result volume because the coding agent did substantial tool-heavy implementation and validation work. It has no generated projection yet, and token-counting status still reports repair-needed because raw/smooth materialized counts are heuristic while lower-band projections and closed chunk summaries already have exact provider-backed counts. A prepare-mode smart compact should repair/refresh the needed token accounting and produce the first generated thread-view for this coder session.

## 2026-05-25T00:17:22Z — current session after reload, before next smart compact

- Archive: `2026-05-25T00-17-22Z-df67cbe0-2c0d-src2211-pre-smart-compact-after-report-reload.zip`
- Metadata: `2026-05-25T00-17-22Z-df67cbe0-2c0d-src2211-pre-smart-compact-after-report-reload.json`
- Thread: `thread_df67cbe0-2c0d-4c6e-90fa-570b04cd9bcc`
- Provided session/compact ID: `sc-df67cbe0-8244cf45-mper265s`
- Active generated thread-view:
  `.context-steward/threads/thread_df67cbe0-2c0d-4c6e-90fa-570b04cd9bcc/generated/projection_8244cf45-3f7b-49a3-9ca2-3f2e1cf612da-thread_view_96a5b154-64b8-408b-8525-df111f9092e9.jsonl`
- Source revision at snapshot: `2211`
- This is a **pre-smart-compact** snapshot taken after reloading the latest committed changes and dogfooding the new `lhx inspect report post-compact` command.

### PI session usage reported by PI

- Messages:
  - User: **87**
  - Assistant: **202**
  - Tool calls: **118**
  - Tool results: **118**
  - Total: **518**
- Tokens:
  - Input: **1,946,222**
  - Output: **36,535**
  - Cache read: **17,018,368**
  - Total: **19,001,125**
- Cost:
  - Total: **19.3363**

### `lhx inspect report post-compact` stats

- Canonical thread messages: **2,209** total
  - prompt: **406**
  - response: **1,060**
  - tool_result: **743**
- Turns: **404 closed / 1 open**
- Chunks: **86 closed / 1 open**
- Generated thread-view records/messages: **651 records / 647 messages**
- Generated tokens: **52,959 exact**
- Status: **degraded=0 repairNeeded=0**

### Current generated band layout

- `full_fidelity`: **12 turns**, turn indices **274–285**, tokenSum **19,563**
- `smooth`: **56 turns**, turn indices **218–273**, tokenSum **19,817**
- `detailed`: **33 chunks**, `chunk-023` through `chunk-055`, tokenSum **19,603**
- `brief`: **22 chunks**, `chunk-001` through `chunk-022`, tokenSum **5,457**

### Token scale

- Canonical raw estimate: **1,819,982**
- Tool-result raw estimate: **1,332,432**
- Raw turn exact total: **982,454**
- Smooth turn exact total: **184,358**
- Generated exact total: **52,959**

### Where we are

This snapshot captures the main active long-horizon session after the latest E2E stabilization and `lhx inspect report post-compact` work were committed and reloaded. The generated context remains healthy with no degraded or repair-needed status. Canonical history has continued to grow substantially, while the active generated view still has a compact exact-counted generated base around 53k tokens plus live continuation records. The next planned action is to run smart compact if reload behavior remains stable.
