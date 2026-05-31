export const HELP_TEXT = `lhx - PI Long Horizon context inspection

Read-only inspector for .context-steward thread state, token rollups, and generated thread-view bands.

USAGE
  lhx inspect <command> [options]
  lhx threads <command> [options]
  lhx thread-events <command> [options]
  lhx <alias> [options]

INSPECT COMMANDS
  lhx inspect summary                Summarize canonical thread health, messages, turns, chunks, and current generated file
  lhx inspect tokens                 Roll up heuristic estimates and provider/exact token metadata
  lhx inspect bands                  Inspect band layout encoded in the latest generated thread-view metadata
  lhx inspect readiness              Show whether strict compact is likely safe or prepare is recommended
  lhx inspect report post-compact    Compose the standard post-smart-compact operator report

THREAD COMMANDS
  lhx threads upsert --thread-db <path> [--name "..."]  Add or update a known thread from canonical thread.sqlite
  lhx threads list                                      List cached catalog rows
  lhx threads show <id-or-name>                         Show one catalog row by id, id prefix, name, or unique name substring
  lhx threads refresh <id-or-name>                      Refresh cached facts from stored thread.sqlite path
  lhx threads refresh --all                             Refresh every known catalog row
  lhx threads resume <id-or-name>                        Print a pi-lh command for resuming a cataloged thread session

THREAD EVENT COMMANDS
  lhx thread-events create --event-db <path> [--client-thread-id <id>]  Create or return a projected thread
  lhx thread-events append --event-db <path> --client-thread-id <id> --file <event.json>  Append caller-provided event input
  lhx thread-events list --event-db <path> [--json]                      List persisted source events
  lhx thread-events read --event-db <path> --client-thread-id <id> [--json]  Read projected messages and blocks

ALIASES
  summary, tokens, bands, readiness  Convenience aliases for lhx inspect summary/tokens/bands/readiness

CONCEPTS
  Canonical Thread: source truth in .context-steward messages/turns/chunks.
  Async artifacts: smooth turns, lower-band projections, summaries, and token metadata.
  Last generated thread-view: smart-compact projection file with band layout at generation time.
  Current active PI context: the generated file may later receive live appended turns; this tool does not guess a new compact allocation.
  Thread catalog: rebuildable manual list view; canonical per-thread thread.sqlite remains source of truth.

OPTIONS
  --root <dir>          Project root containing .context-steward (default: cwd)
  --thread <id>         Thread id under .context-steward/threads
  --thread-dir <dir>    Explicit thread directory
  --thread-view <file>  Explicit generated thread-view JSONL path
  --backing <mode>      Force auto, file, or sqlite loading
  --json                Stable structured output for agents
  --catalog-db <file>   Thread catalog SQLite path for lhx threads commands
  --thread-db <file>    Canonical thread.sqlite path for lhx threads upsert
  --event-db <file>     Dedicated SQLite path for lhx thread-events commands
  --file <event.json>   Append input file for lhx thread-events append
  --client-thread-id <id>  Caller/harness thread id for lhx thread-events
  --name <name>         User-managed catalog name for lhx threads upsert

EXAMPLES
  lhx inspect summary --root .
  lhx inspect tokens --root . --json
  lhx inspect bands --root . --thread thread_abc --json
  lhx inspect readiness --root . --thread thread_abc
  lhx inspect report post-compact --root .
  lhx threads upsert --thread-db .context-steward/threads/thread_abc/thread.sqlite --name "My thread"
  lhx threads list
  lhx threads resume thread_abc
  lhx thread-events create --event-db .context-steward/thread-events.sqlite --client-thread-id pi-session-123
  lhx thread-events append --event-db .context-steward/thread-events.sqlite --client-thread-id pi-session-123 --file event.json
  lhx thread-events list --event-db .context-steward/thread-events.sqlite --json
`;
