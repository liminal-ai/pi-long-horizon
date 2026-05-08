# pi-long-horizon

Baseline PI agent setup using only the ChatGPT OAuth-backed `openai-codex` provider.

## Models

The baseline model set is:

- `openai-codex/gpt-5.4`
- `openai-codex/gpt-5.4-mini`
- `openai-codex/gpt-5.5`

The source of truth is `src/pi-baseline.ts`. Project PI settings in `.pi/settings.json` use the same model set for scoped model cycling.

Default model/thinking is `openai-codex/gpt-5.4-mini` at `medium`.

## Auth

Use the project login helper:

```bash
npm run login
```

This runs PI's ChatGPT Codex OAuth flow for the `openai-codex` provider only and stores credentials under `.pi/agent/auth.json` via `PI_CODING_AGENT_DIR=.pi/agent`.

## Run

```bash
npm run agent
```

The baseline is intentionally dogfooded through PI's interactive TUI rather than a separate smoke script.
