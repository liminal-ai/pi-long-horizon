# @pi-long-horizon/context

Read-only SDK + CLI for inspecting PI Long Horizon `.context-steward` state.

## CLI

```sh
lhx
lhx summary --root .
lhx tokens --root . --json
lhx bands --root . --thread thread_abc --json
```

`--json` emits stable structured output for agents. Human output is concise and avoids dumping message bodies.

Inputs:

- `--root <dir>`: project root containing `.context-steward`
- `--thread <id>`: thread id under `.context-steward/threads`
- `--thread-dir <dir>`: explicit thread directory
- `--thread-view <file>`: explicit generated thread-view JSONL path

## SDK

```ts
import { inspectSummary, inspectTokens, inspectBands } from "@pi-long-horizon/context";

const summary = await inspectSummary({ rootDir: "." });
const tokens = await inspectTokens({ rootDir: "." });
const bands = await inspectBands({ rootDir: "." });
```

## Concepts

- Canonical Thread: source truth from `.context-steward` messages, turns, and chunks.
- Async artifacts: smooth turns, lower-band projections, summaries, and token metadata.
- Last generated thread-view: smart-compact projection file and its band layout at generation time.
- Current active PI context: generated file may have live turns appended after compact; this first slice reports that tail detection as unsupported rather than guessing.
