---
name: billing-report-export
task_sources:
  - docs/tasks.md
instruction_files:
  - docs/product-brief.md
  - docs/engineering-rules.md
decision_file: docs/decisions.md
progress_file: .orchestrator/progress.md
state_file: .orchestrator/state.json
workspace_root: .orchestrator/workspaces
workspace_mode: git_worktree
agent_command: codex
agent_args:
  - exec
max_iterations: 50
poll_interval_seconds: 3
completion_phrase: COMPLETE
required_branch: autonomous/integration
terminal_commit_behavior: per_task
review_every_tasks: 3
auto_push_every_commits: 3
---

# Autonomous Development Workflow

You are shipping a billing-report export feature in a TypeScript product repo.

## How to Work

- Read the instruction files first.
- Work only on the assigned task and any strict prerequisite already called out in the task doc.
- Keep the implementation lean and match existing repo patterns before inventing new abstractions.
- Update `docs/tasks.md` as the task moves from `pending` to `in-progress`, `done`, or `blocked`.
- Record consequential choices in `docs/decisions.md`.
- Run the most relevant validation commands for the files you changed.

## Task Completion Rules

- Mark tasks `in-progress` when work begins.
- Mark tasks `done` only after implementation and relevant validation are complete.
- Mark tasks `blocked` only for a real unresolved dependency.
- If all tracked tasks are complete, say `COMPLETE`.
