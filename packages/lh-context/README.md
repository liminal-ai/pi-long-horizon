# @pi-long-horizon/context

SDK + CLI tools for PI Long Horizon `.context-steward` state.

`lhx` is the read-only inspection surface. The package also ships `pi-lh`, a small PI launcher that loads the packaged Long Horizon extension from this package.

## CLI

```sh
lhx
lhx summary --root .
lhx tokens --root . --json
lhx bands --root . --thread thread_abc --json
pi-lh [pi args...]
```

`lhx --json` emits stable structured output for agents. Human output is concise and avoids dumping message bodies.

`pi-lh` runs PI from the caller's current directory, passes non-help PI args through, loads `dist/pi-extension/index.js`, and sets `PI_CODING_AGENT_DIR=<cwd>/.pi/agent` for project-local PI state. `pi-lh --help` prints launcher help without creating PI runtime state.

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
