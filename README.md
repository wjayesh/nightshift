# Standalone Orchestrator

A small, repo-native autonomous coding loop you can copy into another project.
It keeps planning and execution in markdown, selects the next ready task from
`Depends on`, runs one task at a time, and preserves operational memory in
repo-owned files instead of a database or hosted tracker.

This repository is still the extraction workspace inside Mahilo. That means the
standalone examples here use `WORKFLOW.orchestrator.md` and
`docs/tasks-standalone-orchestrator.md`, because the root `WORKFLOW.md` is
already used by Mahilo's existing server workflow. In a copied standalone repo,
the default shape is `WORKFLOW.md`, `docs/tasks.md`, `docs/decisions.md`, and
`.orchestrator/`.

## Core Mental Model

The repo is the control plane.

- The workflow file defines where tasks live, which instruction docs should be
  read first, where runtime artifacts are written, which agent command to run,
  which workspace mode to use, and how git integration should behave.
- Task docs stay hand-editable markdown. The orchestrator only needs `ID`,
  `Status`, `Priority`, and `Depends on`.
- The scheduler only picks ready tasks. A task is ready when its dependencies
  are already `done`.
- One workflow works on one active task at a time.
- Runtime artifacts under `.orchestrator/` are part of the product surface, not
  throwaway temp files.
- Consequential choices go into a decision log that stays readable in git
  history.
- Terminal task outcomes are committed deliberately, and pushing is controlled
  by an explicit cadence instead of happening accidentally.

## Quick Start

### Prerequisites

- Bun 1.0 or newer
- Git
- The agent CLI named in the workflow file on your `PATH`

The extracted orchestrator itself only relies on Bun, Git, and the configured
agent command. In this repo the standalone workflow uses `codex exec`.

### Run The Standalone Workflow In This Repo

Install dependencies:

```bash
bun install
```

Preview the next ready task without running the agent:

```bash
bun run scripts/orchestrator.ts --workflow WORKFLOW.orchestrator.md --once --dry-run
```

Run a single live iteration:

```bash
bun run scripts/orchestrator.ts --workflow WORKFLOW.orchestrator.md --once
```

Run the loop continuously until completion or `max_iterations`:

```bash
bun run scripts/orchestrator.ts --workflow WORKFLOW.orchestrator.md
```

`--dry-run` is the safest first check. It confirms that the workflow file
loads, task parsing works, dependencies resolve, and the prompt can be built for
the next ready task.

### CLI Flags

```text
Usage: bun run scripts/orchestrator.ts [options]

Options:
  --workflow <path>        Workflow file to load (default: WORKFLOW.md)
  --max-iterations <n>     Override workflow max_iterations
  --once                   Run a single loop iteration
  --dry-run                Select a task and print a prompt preview without running the agent
  --help                   Show this help text
```

In a copied repo, `WORKFLOW.md` becomes the default and you can drop the
`--workflow` flag.

## Workflow File

The workflow file has two parts:

- Front matter: machine-read configuration.
- Body: human instructions that are injected into every task prompt.

A copied standalone repo should look roughly like this:

```md
---
name: autonomous-development
task_sources:
  - docs/tasks.md
dependency_sources:
  - docs/shared-dependencies.md
instruction_files:
  - docs/prd.md
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

Read the instruction files first.
Update the task doc status as work progresses.
Record consequential choices in the decision log.
```

The current extraction repo uses the same shape but points at
`WORKFLOW.orchestrator.md`, `docs/tasks-standalone-orchestrator.md`, and
suffixed runtime artifact names such as `.orchestrator/orchestrator-progress.md`
to avoid colliding with Mahilo's existing workflows.

Important front matter fields:

- `task_sources`: task docs the orchestrator reads and expects the agent to
  update.
- `dependency_sources`: optional docs used only to satisfy `Depends on`
  references across other files.
- `instruction_files`: repo docs that must be read before the task section.
- `decision_file`: markdown log for consequential implementation choices.
- `progress_file` and `state_file`: durable runtime memory.
- `workspace_root`: where shared workspaces or git worktrees live.
- `workspace_mode`: `git_worktree` by default, `shared` as the escape hatch.
- `agent_command` and `agent_args`: the exact agent invocation.
- `completion_phrase`: phrase the agent should emit when all tracked tasks are
  complete.
- `required_branch`: optional guardrail that forces integration onto a specific
  branch.
- `terminal_commit_behavior`: currently `per_task`; every `done` or `blocked`
  task is committed deliberately before integration.
- `review_every_tasks`: review cadence. `3` is the recommended default, `0`
  disables the built-in review pass.
- `auto_push_every_commits`: push cadence. `3` is the recommended default, `0`
  keeps integration commits local until a human pushes.

## Task Docs And Dependency-Aware Scheduling

Task docs stay intentionally simple. Each task is just a markdown heading plus a
few metadata lines:

```md
### 2.1 Write setup and usage guide

- **ID**: `ORCH-020`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-011, ORCH-012, ORCH-013

Write a README that explains setup, workflow files, task docs, runtime
artifacts, and how to copy the repo into a new project.
```

Supported status values are:

- `pending`
- `in-progress`
- `review`
- `blocked`
- `done`

Scheduling rules are straightforward:

- The orchestrator reads every configured `task_sources` file.
- It ignores tasks whose dependencies are not yet `done`.
- It can also gate tasks on other docs listed in `dependency_sources`.
- It keeps working the current active task until that task reaches a terminal
  state or the agent exits without completing it.

The goal is to keep task editing cheap. If a human can edit the markdown by
hand, the orchestrator should still understand it.

## Runtime Artifacts

Runtime files are a first-class feature. They preserve operational memory
between runs and make the loop inspectable without extra tooling.

The standalone layout uses `.orchestrator/` for:

- `progress.md`: append-only iteration log with task IDs, statuses, and notes.
- `state.json`: persisted loop state such as iteration count, active task,
  commit counters, and history.
- `reviews.md`: append-only review log written next to the configured
  `state_file`. It records each review batch, remediation task IDs, and the
  captured last-message path.
- `worker-<workflow>.lock`: long-lived lock held for the lifetime of one
  workflow loop so duplicate same-workflow starts fail fast in the same repo
  clone.
- `repo.lock`: short-lived lock used only around integration-branch mutation.
- `<task-id>-last-message.txt`: the terminal agent message for each task.
- `workspaces/`: shared task directories or git worktrees, depending on
  `workspace_mode`.

In this repo, the standalone workflow writes the same artifact types with
workflow-specific filenames such as `orchestrator-progress.md`,
`orchestrator-state.json`, and `orchestrator-reviews.md`.

## Decision Docs

Decision logging is configured by `decision_file`. The default shape is a plain
markdown log such as `docs/decisions.md`.

Use it for choices that should outlive a single agent run:

- changing workflow policy
- changing task interpretation
- choosing one implementation path over another
- documenting why a workaround exists

Recommended entry format:

```md
## YYYY-MM-DD - TASK-ID - Short decision title

- Context: What forced the choice?
- Decision: What was chosen and why?
- Impact: What should later readers expect because of it?
```

The important part is not the exact template. The important part is that the
repo keeps durable reasoning next to code and task history.

## Review Cadence

Review cadence is part of the standalone operating model, not an afterthought.
The recommended default is to run a review after every 3 completed
implementation tasks.

`review_every_tasks` controls both when the review runs and how many recently
completed tasks the reviewer inspects in that batch.

The built-in behavior is:

- after every 3 completed implementation tasks, run a review pass
- inspect the last 3 completed tasks together
- create new high-priority follow-up tasks if acceptance criteria or behavior
  were missed
- persist the outcome in `.orchestrator/state.json`,
  `.orchestrator/progress.md`, a review log such as `.orchestrator/reviews.md`,
  and a per-review last-message file such as
  `.orchestrator/review-001-last-message.txt`

If you do not want automated review passes in a specific workflow, set
`review_every_tasks: 0`.

## Commit And Push Cadence

Git behavior is explicit on purpose.

- `terminal_commit_behavior: per_task` means every `done` or `blocked` task gets
  a terminal commit before integration.
- `auto_push_every_commits: 3` is the recommended default for a standalone repo.
  It batches pushes without hiding work for too long.
- `auto_push_every_commits: 0` disables automatic pushes and keeps integrated
  commits local until a human decides to publish them.
- `required_branch` can pin all integration onto a named branch instead of
  whatever branch the loop happens to start from.

This repo intentionally sets `auto_push_every_commits: 0` in
`WORKFLOW.orchestrator.md` so standalone extraction work stays local until it is
reviewed and pushed deliberately.

## Copy This Into A New Repo

The adoption model is intentionally small.

If you want a copyable starting point instead of a blank file, use
`examples/WORKFLOW.example.md`, `examples/tasks.example.md`, and
`examples/decisions.example.md` as the initial templates for `WORKFLOW.md`,
`docs/tasks.md`, and `docs/decisions.md`.

1. Copy `src/orchestrator.ts` and `scripts/orchestrator.ts` into the new repo.
2. Add a root `WORKFLOW.md` based on `WORKFLOW.orchestrator.md`.
3. Create `docs/tasks.md` and `docs/decisions.md`.
4. Point `task_sources`, `instruction_files`, and `decision_file` at docs that
   make sense for the new project.
5. Set `agent_command` and `agent_args` to the local agent CLI you actually use.
6. Keep runtime output under `.orchestrator/`.
7. Run `bun run scripts/orchestrator.ts --once --dry-run` before the first live
   execution.

What usually stays unchanged:

- `src/orchestrator.ts`
- `scripts/orchestrator.ts`
- the `.orchestrator/` runtime layout

What you usually edit per repo:

- `WORKFLOW.md`
- task docs under `docs/`
- instruction docs
- the decision log path, if you want a different location

If your repo is comfortable with git worktrees, keep `workspace_mode` set to
`git_worktree`. If not, start with `workspace_mode: shared` and switch later.
The orchestrator is opinionated, but the amount of repo-specific adaptation is
meant to stay small and visible.
