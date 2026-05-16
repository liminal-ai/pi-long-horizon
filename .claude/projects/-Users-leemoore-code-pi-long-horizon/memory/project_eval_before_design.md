---
name: Eval-first process for epics
description: User evaluates models and prompts empirically before finalizing tech designs — tech design follows eval results, not the other way around
type: project
---

The epic process follows: evaluate models/prompts for the capability → finalize tech design informed by eval results → implement → manually test implementation. Did this for Epic 4 (smoothing model/prompt eval before implementation) and will do it for Epic 5 (compression model/prompt eval after Epic 5 plumbing is verified but before tech design is finalized).

**Why:** Committing to model choice, prompt structure, or retry policy in a tech design before seeing real output against real data leads to rework.

**How to apply:** During spec and tech design work, flag any decisions that should be deferred until eval results are in. Don't assume model/prompt choices are locked — they're hypotheses until tested.
