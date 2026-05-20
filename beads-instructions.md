# Beads Instructions

This project uses **bd (beads)** for issue tracking.

## Purpose

Beads is the primary tracker for actionable backlog items, priorities, dependencies, ready/blocked state, and multi-agent handoff.

Markdown remains appropriate for ADRs, design notes, specs, and narrative context. Do not treat `.tech-lead/backlog.md` as the live task tracker unless explicitly instructed.

## Core Commands

```bash
bd prime                 # Show current agent workflow context
bd ready                 # Find unblocked work
bd show <id>             # View issue details and audit trail
bd update <id> --claim   # Claim work atomically
bd close <id>            # Complete work
bd list                  # List issues
bd status                # Database overview
bd create "Title" --type task --priority 2
```

Use `--json` when structured output is useful for agents.

## Storage / Sync Notes

Issues live in a local Dolt database under `.beads/`. `.beads/issues.jsonl` is an export/view artifact, not the source of truth.

Cross-machine sync uses Beads/Dolt commands such as:

```bash
bd dolt push
bd dolt pull
```

Do not `bd import` during normal operation unless intentionally restoring/importing data.

## Agent Usage Guidance

- Use Beads for actionable tasks instead of ad hoc markdown TODO lists.
- Use `bd ready` to find work and `bd show <id>` before starting.
- Claim work with `bd update <id> --claim` when appropriate.
- Close issues only when the work and validation are actually complete.
- Add comments/notes to issues when useful for handoff.

## Project Preference

Keep root `AGENTS.md` minimal. Detailed Beads workflow belongs here, not in `AGENTS.md`.
