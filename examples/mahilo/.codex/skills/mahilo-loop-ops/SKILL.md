---
name: mahilo-loop-ops
description: Archived skill example for operating the Mahilo server and plugin workflows that were carried during standalone extraction.
---

# Mahilo Loop Ops

## Overview

This archived skill shows how the orchestrator was used to operate Mahilo's
server and plugin workflows before they were moved out of the standalone core
surface.

## Preconditions

- Run from the repo root.
- Confirm the current branch matches the checkout you intend to guard before
  starting any loop. When `required_branch` is omitted, the orchestrator guards
  the current branch automatically.
- Use `examples/mahilo/WORKFLOW.md` for the archived server workflow and
  `examples/mahilo/WORKFLOW.plugin.md` for the archived plugin workflow.
- Use an explicit integration branch, not `main`, for autonomous Mahilo work.

## Quick Start

1. Verify the branch and basic task selection:
   - `git branch --show-current`
   - `bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.md --once --dry-run`
   - `bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.plugin.md --once --dry-run`
2. Start the server loop in detached `screen`:
   - `screen -dmS mahilo-server-loop zsh -lc 'cd <repo-root> && bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.md >> .mahilo-orchestrator/server-loop.log 2>&1'`
3. Start the plugin loop in detached `screen`:
   - `screen -dmS mahilo-plugin-loop zsh -lc 'cd <repo-root> && bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.plugin.md >> .mahilo-orchestrator/plugin-loop.log 2>&1'`
4. Confirm both sessions exist:
   - `screen -ls`

## Health Checks

- Active screen sessions:
  - `screen -ls`
- Server progress:
  - `tail -n 40 .mahilo-orchestrator/progress.md`
- Plugin progress:
  - `tail -n 40 .mahilo-orchestrator/plugin-progress.md`
- Server runtime log:
  - `tail -n 80 .mahilo-orchestrator/server-loop.log`
- Plugin runtime log:
  - `tail -n 80 .mahilo-orchestrator/plugin-loop.log`
- One-shot task selection checks:
  - `bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.md --once`
  - `bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.plugin.md --once`

## Restart Flow

1. Stop existing sessions if present:
   - `screen -S mahilo-server-loop -X quit`
   - `screen -S mahilo-plugin-loop -X quit`
2. Confirm they are gone:
   - `screen -ls`
3. Re-run the dry-run commands:
   - `bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.md --once --dry-run`
   - `bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.plugin.md --once --dry-run`
4. Start both detached sessions again with the Quick Start commands.

## Stop Flow

- Stop server loop:
  - `screen -S mahilo-server-loop -X quit`
- Stop plugin loop:
  - `screen -S mahilo-plugin-loop -X quit`
- Confirm shutdown:
  - `screen -ls`

## Safety Rules

- Do not start the loops from `main`.
- Keep the server and plugin loops on the same integration branch unless the
  workflow model is intentionally changed.
- Treat this skill and the `examples/mahilo/` workflows as archived examples,
  not the standalone orchestrator backlog.
- If you need to edit orchestrator code or shared workflow files while loops
  are live, prefer a quick stop/restart or acquire the same repo lock used by
  the orchestrator before manual commit/push steps.
- Prefer reading `examples/mahilo/docs/autonomous-orchestrator.md`,
  `examples/mahilo/WORKFLOW.md`, and `examples/mahilo/WORKFLOW.plugin.md`
  before changing the archived example behavior.

## Important Paths

- Server workflow: `examples/mahilo/WORKFLOW.md`
- Plugin workflow: `examples/mahilo/WORKFLOW.plugin.md`
- Archived operator doc: `examples/mahilo/docs/autonomous-orchestrator.md`
- Orchestrator runtime: `scripts/orchestrator.ts`
- Orchestrator core: `src/orchestrator.ts`
- Server progress: `.mahilo-orchestrator/progress.md`
- Plugin progress: `.mahilo-orchestrator/plugin-progress.md`
- Server log: `.mahilo-orchestrator/server-loop.log`
- Plugin log: `.mahilo-orchestrator/plugin-loop.log`
- Orchestrator state: `.mahilo-orchestrator/state.json`
- Plugin state: `.mahilo-orchestrator/plugin-state.json`

## When To Escalate

Escalate when:

- a loop repeatedly exits on the same task
- `screen` sessions disappear immediately after startup
- dry runs do not pick the expected ready task
- the integration branch is wrong or dirty in a way that blocks safe restart
- the plugin loop needs a server or contract change instead of a plugin-only
  change
