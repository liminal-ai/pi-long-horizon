# Long Horizon publish/global availability plan

## Objective

Make the existing Long Horizon tooling installable once and usable from any project directory in the same shape we expect to npm publish.

Target operator workflow:

```bash
# from any target repo
lhx inspect report post-compact --root .
pi-lh
```

Expected behavior:

- `lhx` reads the target repo's `./.context-steward` state.
- `pi-lh` launches PI with the Long Horizon extension available.
- Long Horizon state for the target repo is written under that repo's `./.context-steward/`.
- Installed tooling does not depend on being run from the `pi-long-horizon` source checkout.
- The package can be validated locally with `npm pack` / install or link before public publishing.

This plan is only about global availability / publish readiness. It is not a broader Long Horizon product roadmap.

## Current validated state

The first slice is not starting from zero.

Current package state:

```json
// packages/lh-context/package.json
{
  "name": "@pi-long-horizon/context",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "lhx": "./dist/cli.js"
  },
  "files": ["dist", "README.md"]
}
```

Current CLI state:

- `packages/lh-context` already exists as a separate package.
- `lhx` already exists as the context inspection CLI.
- `lhx` already has a package `bin` entry pointing at `./dist/cli.js`.
- The remaining `lhx` work is publish/link validation and any package hardening discovered by that validation.

Current PI-extension state:

```ts
// .pi/extensions/context-steward.ts
export { default } from "../../src/context-steward/pi/pi-extension.js";
```

That shim is repo-local. It is fine for source checkout development, but it is not the installed/published shape.

Missing pieces for this objective:

- `pi-lh` binary.
- Build/package shape for the PI launcher + extension code. This is the main implementation gap: root `src/` is not currently emitted for publish, and `packages/lh-context` only builds its own `src`.
- Packaged PI extension entry resolvable from package `dist`.
- Launcher wiring that uses the packaged extension entry instead of `.pi/extensions/context-steward.ts`.
- External-directory smoke validation for both `lhx` and `pi-lh`.

## Distribution architecture

For this first publishable slice, use one installed npm package/artifact for both CLIs. The package should expose both binaries:

```json
{
  "bin": {
    "lhx": "./dist/cli.js",
    "pi-lh": "./dist/pi-lh.js"
  }
}
```

Conceptual split:

```text
lhx
  portable Long Horizon context inspection CLI/SDK
  reads .context-steward from --root or cwd
  no PI UI/runtime dependency

pi-lh
  PI-specific launcher
  starts PI from the caller's working directory
  passes through PI args
  configures PI to load the packaged Long Horizon extension

packaged extension entry
  built dist entry that exports/registers the existing PI extension
  replaces installed-use dependency on the repo-local .pi/extensions shim
  writes state under the target repo .context-steward via PI ctx.cwd
```

Keep the implementation separation clear:

- `lhx` remains the context inspection surface.
- `pi-lh` is a launcher/runtime adapter.
- The existing PI extension code can remain in the root `src` tree for this slice if the package can include/build a stable entry to it. Do not move PI extension internals unless packaging requires it.
- The exact package name can be revisited later if `@pi-long-horizon/context` becomes too narrow, but do not split packages for this MVP slice.

## Execution plan

### 1. Validate and harden existing `lhx` package

Confirm the existing package behaves like an installed npm package:

```bash
cd packages/lh-context
npm run typecheck
npm run test
npm run build
npm pack
```

Then install/link the packed artifact from an unrelated directory and validate:

```bash
lhx --help
lhx summary --root <repo-with-context> --json
lhx tokens --root <repo-with-context> --json
lhx bands --root <repo-with-context> --json
lhx inspect report post-compact --root <repo-with-context> --json
```

Check and fix only package-readiness issues found here:

- built CLI has a shebang;
- `bin.lhx` points to the built file;
- `files` includes all required runtime files;
- no runtime imports resolve to unpublished source paths;
- `--root` / cwd behavior works from outside the source checkout.

### 2. Choose the smallest build/package shape for `pi-lh` + extension

Before adding launcher behavior, make the package able to emit everything it must run after `npm pack`.

Acceptable first-slice options:

- broaden the existing package build so the package includes compiled `pi-lh` and PI extension entry code; or
- create a publish wrapper package/artifact that includes/re-exports `lhx` plus compiled PI launcher/extension code.

For this MVP, prefer the smallest option that produces a packed artifact with both binaries and no source-checkout imports. Do not do a large source-tree refactor just to make the package shape elegant.

The package should also include PI package metadata for native PI compatibility:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./dist/pi-extension/index.js"]
  }
}
```

`pi-lh` may still launch PI with an explicit `--extension/-e <dist path>` in the first slice. The manifest keeps the artifact aligned with PI's native npm/git package shape.

### 3. Add `pi-lh` launcher binary

Add a package binary:

```json
{
  "bin": {
    "lhx": "./dist/cli.js",
    "pi-lh": "./dist/pi-lh.js"
  }
}
```

Minimal supported invocation:

```bash
pi-lh [pi args...]
```

Launcher responsibilities:

- run PI from the caller's current working directory;
- preserve the caller cwd as the target project root;
- launch PI with `PI_CODING_AGENT_DIR=<launch-cwd>/.pi/agent` by default;
- treat that as an explicit product choice: it keeps PI sessions/auth/settings project-local for dogfood isolation, but it may require first-run auth/settings in each repo;
- do not silently preserve an inherited `PI_CODING_AGENT_DIR`, because that could route PI agent/session/config state to an unrelated directory;
- depend on `@earendil-works/pi-coding-agent` for the launcher path rather than assuming a global `pi` binary;
- pass through PI args/model settings;
- configure PI to load the packaged Long Horizon extension;
- not rely on root package scripts like `npm run agent`;
- not rely on `.pi/extensions/context-steward.ts`.

Keep first-run UX minimal. Doctor/init/config commands are not required for this slice.

### 4. Add packaged PI extension entry

Add a built package entry that PI can resolve after npm install/link.

Requirements:

- exports/registers the existing Long Horizon PI extension;
- builds into package `dist`;
- is included by package `files`;
- can be referenced by `pi-lh` without source-checkout-relative paths;
- does not change extension behavior except how it is resolved/loaded.

The development shim may remain for local source-checkout workflows, but installed use must go through the packaged entry.

Dependency note: for native PI package loading, PI core packages should be compatible with peer dependency expectations. First slice is global CLI launcher first; native `pi install npm:...` compatibility is secondary but should not be made harder by the package shape.

### 5. Verify target-root behavior from another directory

From a temp external project directory, install/link the packed package and run a smoke launch.

Example:

```bash
mkdir -p /tmp/lh-publish-smoke
cd /tmp/lh-publish-smoke
# install/link packed @pi-long-horizon/context artifact
lhx --help
pi-lh --help   # or dry launch if available
```

Then run a real or minimal PI launch from that external directory and verify:

```text
/tmp/lh-publish-smoke/.pi/agent/ is used for PI agent/session/config state
/tmp/lh-publish-smoke/.context-steward/ exists
canonical thread files are written there
generated thread-view files are written there when applicable
lhx summary --root . works
lhx inspect report post-compact --root . works when generated output exists
```

If any files write under the package install directory or source checkout instead of the target repo, fix that path resolution before considering the slice ready.

### 6. Package readiness check

Before closing the work:

- inspect `npm pack` contents;
- confirm both binaries run from an unrelated directory;
- confirm package metadata is sane for eventual publish;
- document the local install/link commands and smoke outputs;
- update bead `pi-long-horizon-1vt` with validation evidence.

## Portability checks during implementation

Review only the path/root assumptions relevant to this publish/global-availability objective:

- repo-local `.pi/extensions/*` shim usage;
- package `dist` entry points;
- package `files` contents;
- `process.cwd()` uses that write `.context-steward/debug` or similar;
- assumptions about `PI_CODING_AGENT_DIR`;
- whether PI launched by `pi-lh` runs with cwd equal to the caller's target repo.

Do not broaden this into general architecture cleanup. Patch issues only when they block installed/global use.

## Non-goals

- final public package naming beyond the current package shape;
- npm release automation;
- doctor/init commands;
- SQLite storage migration;
- moving repair/compact mutation operations into `lhx`;
- changing smart-compact behavior;
- redesigning PI extension internals;
- replacing the PI extension with CLI calls.
