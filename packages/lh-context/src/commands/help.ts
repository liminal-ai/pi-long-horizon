export const HELP_TEXT = `lhx - PI Long Horizon context inspection

Read-only inspector for .context-steward thread state, token rollups, and generated thread-view bands.

USAGE
  lhx inspect <command> [options]
  lhx <alias> [options]

INSPECT COMMANDS
  lhx inspect summary                Summarize canonical thread health, messages, turns, chunks, and current generated file
  lhx inspect tokens                 Roll up heuristic estimates and provider/exact token metadata
  lhx inspect bands                  Inspect band layout encoded in the latest generated thread-view metadata
  lhx inspect report post-compact    Compose the standard post-smart-compact operator report

ALIASES
  summary, tokens, bands             Convenience aliases for lhx inspect summary/tokens/bands

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
  lhx inspect summary --root .
  lhx inspect tokens --root . --json
  lhx inspect bands --root . --thread thread_abc --json
  lhx inspect report post-compact --root .
`;
