---
name: mahilo-server-autonomous-development
task_sources:
  - docs/prd-server-policy-platform.md
instruction_files:
  - CLAUDE.md
  - docs/openclaw-plugin-server-contract.md
  - docs/permission-system-design.md
progress_file: .mahilo-orchestrator/progress.md
state_file: .mahilo-orchestrator/state.json
workspace_root: .mahilo-orchestrator/workspaces
workspace_mode: git_worktree
agent_command: codex
agent_args:
  - exec
  - --dangerously-bypass-approvals-and-sandbox
max_iterations: 50
poll_interval_seconds: 3
completion_phrase: COMPLETE
terminal_commit_behavior: per_task
review_every_tasks: 0
auto_push_every_commits: 3
---

# Mahilo Server Autonomous Workflow

Historical Mahilo example note: this workflow was moved under
`examples/mahilo/` to show how the orchestrator was used on a real repo. The
standalone source of truth in this repo is `WORKFLOW.orchestrator.md`.

You are the implementation agent for Mahilo server work.

Your job is to autonomously move the server task list forward using the task
documents as the source of truth.

## How to Work

- Read the instruction files first.
- Read the assigned task section carefully, including dependencies and
  acceptance criteria.
- Implement the task fully before moving on.
- Prefer focused, incremental changes that keep the repo working.
- Add a short progress note after each iteration.
- Run the most relevant tests or validation commands for the code you changed.
- Do not start unrelated tasks just because they are nearby.
- Do not edit the task status metadata directly; let the orchestrator record
  terminal `done` or `blocked` after successful integration.

## Task Completion Rules

- Report terminal completion with `TASK_DONE <task-id>`.
- Report terminal blockers with `TASK_BLOCKED <task-id>: <reason>`.
- If all tracked tasks are done, say `COMPLETE`.

## Coordination Rules

- Treat the tracked markdown docs as the issue tracker.
- Respect dependency ordering.
- Prefer P0 work before lower priorities.
- Use the assigned workspace only.
