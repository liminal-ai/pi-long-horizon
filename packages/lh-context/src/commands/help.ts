export const HELP_TEXT = `lhx - PI Long Horizon context inspection

Read-only inspector for .context-steward thread state, token rollups, and generated thread-view bands.

USAGE
  lhx <command> [options]

COMMANDS
  summary   Summarize canonical thread health, messages, turns, chunks, and current generated file
  tokens    Roll up heuristic estimates and provider/exact token metadata
  bands     Inspect band layout encoded in the latest generated thread-view metadata

CONCEPTS
  Canonical Thread: source truth in .context-steward messages/turns/chunks.
  Async artifacts: smooth turns, lower-band projections, summaries, and token metadata.
  Last generated thread-view: smart-compact projection file with band layout at generation time.
  Current active PI context: the generated file may later receive live appended turns; this tool does not guess a new compact allocation.

OPTIONS
  --root <dir>          Project root containing .context-steward (default: cwd)
  --thread <id>         Thread id under .context-steward/threads
  --thread-dir <dir>    Explicit thread directory
  --thread-view <file>  Explicit generated thread-view JSONL path
  --json                Stable structured output for agents

EXAMPLES
  lhx summary --root .
  lhx tokens --root . --json
  lhx bands --root . --thread thread_abc --json
`;
