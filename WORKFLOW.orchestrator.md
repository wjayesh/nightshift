---
name: standalone-orchestrator-development
task_sources:
  - docs/tasks-standalone-orchestrator.md
instruction_files:
  - docs/standalone-orchestrator-prd.md
decision_file: docs/decisions.md
progress_file: .orchestrator/orchestrator-progress.md
state_file: .orchestrator/orchestrator-state.json
workspace_root: .orchestrator/orchestrator-workspaces
workspace_mode: git_worktree
agent_command: codex
agent_args:
  - exec
  - --dangerously-bypass-approvals-and-sandbox
max_iterations: 50
poll_interval_seconds: 3
completion_phrase: COMPLETE
terminal_commit_behavior: per_task
# Temporarily disabled for the hardening sprint so the queue starts with
# runtime-safety work instead of retroactive reviews of earlier tasks.
review_every_tasks: 0
# 0 disables automatic pushes; commits remain local until manually pushed.
auto_push_every_commits: 0
# Retry transient task failures a few times before leaving the task pending for
# operator follow-up.
task_failure_retry_limit: 3
task_failure_backoff_seconds: 30
---

# Standalone Orchestrator Workflow

You are building a lean, reusable autonomous coding orchestrator repo.

The goal is to extract the current Mahilo-specific orchestration ideas into a general repo that can be copied into future projects with minimal adaptation.

The standalone repo should explicitly preserve durable runtime artifacts, dependency-aware task selection, decision logging, configurable review cadence, and configurable git integration cadence.

## How to Work

- Read the instruction files first.
- Keep the implementation lean and opinionated rather than overly modular.
- Reuse the current orchestrator code where it already fits the standalone goal.
- Prefer repo-native files and conventions over external services or large frameworks.
- Treat decision docs, progress/state artifacts, review cadence, and commit/push cadence as first-class product behaviors.
- Update the configured decision doc when you make or revise a consequential implementation choice.
- Add concise progress notes to the task list section when useful.
- Run the most relevant validation commands for the files you changed.
- Treat `examples/mahilo/` as a historical example of how this orchestrator was used inside Mahilo, not the standalone source of truth for this repo.

## Task Completion Rules

- Do not edit the task status metadata directly; let the orchestrator record terminal `done` or `blocked` after successful integration.
- Report terminal completion with `TASK_DONE <task-id>`.
- Report terminal blockers with `TASK_BLOCKED <task-id>: <reason>`.
- If all tracked tasks are done, say `COMPLETE`.

## Coordination Rules

- Treat `docs/tasks-standalone-orchestrator.md` as the source of truth.
- Respect dependency ordering.
- Build the smallest reusable surface first.
- Do not add optional systems until they clearly support the standalone repo goal.
