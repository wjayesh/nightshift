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

## What This Variant Adds

Symphony is a good base spec for autonomous orchestration. This repo is one
repo-native adaptation of that idea, tuned for the way I code and meant to be
cloned and adapted again by other people.

The extra behavior bundled here is:

- markdown task docs as the control plane, with `ID`, `Status`, `Priority`, and
  `Depends on`, instead of assuming a hosted tracker
- configurable file-backed runtime memory through `progress_file` and
  `state_file`, plus sibling `status.json`, `heartbeat.json`,
  `supervisor-status.json`, review logs, decision logs, and per-task
  `*-last-message.txt`
- dependency-aware scheduling across one or more task docs, plus read-only
  `dependency_sources` for external prerequisites
- explicit waiting semantics so unmet dependencies and retry windows stay
  visible while tasks remain `pending`
- a built-in review loop with `review_every_tasks`, review-created remediation
  tasks, and durable review artifacts
- explicit git policy through `required_branch`, `terminal_commit_behavior`, and
  configurable `auto_push_every_commits`
- isolated task execution with git worktrees as the default path and shared
  workspace mode as the escape hatch
- orchestrator-owned terminal status updates so workers do not create avoidable
  task-doc conflicts
- runtime hardening through workflow worker locks, dirty integration guards,
  retry/backoff, stale-workspace refresh, a standalone supervisor, and optional
  macOS `launchd`

If that combination matches how you work, clone this repo, keep the pieces you
want, and adapt the workflow and task docs to your own repo.

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
Do not edit task-tracker status metadata directly; report `TASK_DONE` or
`TASK_BLOCKED` instead.
Record consequential choices in the decision log.
```

The current extraction repo uses the same shape but points at
`WORKFLOW.orchestrator.md`, `docs/tasks-standalone-orchestrator.md`, and
suffixed runtime artifact names such as `.orchestrator/orchestrator-progress.md`,
`.orchestrator/orchestrator-status.json`, and
`.orchestrator/orchestrator-heartbeat.json` to avoid colliding with Mahilo's
existing workflows.

Important front matter fields:

- `task_sources`: task docs the orchestrator reads and expects the agent to
  update inside the assigned task section. The orchestrator, not the worker,
  owns terminal `Status` line changes.
- `dependency_sources`: optional docs used only to satisfy `Depends on`
  references across other files. They are read-only prerequisite docs for this
  workflow, not another actionable queue.
- `instruction_files`: repo docs that must be read before the task section.
- `decision_file`: markdown log for consequential implementation choices.
- `progress_file` and `state_file`: durable runtime memory. `state_file` also
  determines the sibling `status.json`, `heartbeat.json`, and `reviews.md`
  runtime artifact names.
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

- `pending`: not started yet, waiting on unmet dependencies, or waiting for a
  scheduled retry.
- `in-progress`: currently assigned to the worker.
- `review`: held for a repo-defined review queue; the default scheduler does
  not auto-start it.
- `blocked`: terminal or manual-intervention outcome only.
- `done`: finished and integrated.

Scheduling rules are straightforward:

- The orchestrator reads every configured `task_sources` file.
- It ignores `pending` tasks whose dependencies are not yet `done`; those tasks
  stay `pending` and are surfaced as waiting in runtime notes.
- It can also gate tasks on other docs listed in `dependency_sources`, but
  those docs are read-only prerequisites for this workflow.
- Review-created remediation tasks use `REVIEW-<review>-<n>` IDs, stay
  `pending` + `P0`, and win same-priority ties over ordinary ready tasks.
- It keeps working the current active task until that task reaches a terminal
  state or the agent exits without completing it.

Waiting behavior stays explicit without adding a separate `waiting` status:

- Unmet `Depends on` keeps a task `pending`.
- Retry backoff keeps a task `pending` and visible in `state.json` and
  `status.json`.
- `blocked` is reserved for `TASK_BLOCKED` or deliberate human intervention,
  not ordinary dependency waits.
- Cross-project waits are one-way: local `task_sources` may wait on
  `dependency_sources`, but this workflow never schedules work from those
  dependency docs.

The goal is to keep task editing cheap. If a human can edit the markdown by
hand, the orchestrator should still understand it.

## Runtime Artifacts

Runtime files are a first-class feature. They preserve operational memory
between runs and make the loop inspectable without extra tooling.

The standalone layout uses `.orchestrator/` for:

- `progress.md`: append-only iteration log with task IDs, statuses, and notes.
- `state.json`: persisted loop state such as iteration count, active task,
  commit counters, and history.
- `status.json`: structured runtime health snapshot with the current phase,
  active task, iteration, last note or error, heartbeat timestamp, and retry
  metadata.
- `heartbeat.json`: lightweight heartbeat view with the current phase, active
  task, iteration, and last note or error for simple polling or stall checks.
- `supervisor-status.json`: the supervisor's current state, restart count,
  worker PID, and last restart reason when supervised mode is running.
- `reviews.md`: append-only review log written next to the configured
  `state_file`. It records each review batch, remediation task IDs, and the
  captured last-message path.
- `worker-<workflow>.lock`: long-lived lock held for the lifetime of one
  workflow loop so duplicate same-workflow starts fail fast in the same repo
  clone.
- `supervisor-<workflow>.lock`: long-lived lock held for the lifetime of one
  supervisor so duplicate same-workflow supervisors fail fast in the same repo
  clone.
- `repo.lock`: short-lived lock used only around integration-branch mutation.
- `<task-id>-last-message.txt`: the terminal agent message for each task.
- `workspaces/`: shared task directories or git worktrees, depending on
  `workspace_mode`.

In this repo, the standalone workflow writes the same artifact types with
workflow-specific filenames such as `orchestrator-progress.md`,
`orchestrator-state.json`, `orchestrator-status.json`,
`orchestrator-heartbeat.json`, `orchestrator-supervisor-status.json`, and
`orchestrator-reviews.md`.

## Inspect Runtime Health

If `state_file` is `.orchestrator/state.json`, the worker also writes
`.orchestrator/status.json` and `.orchestrator/heartbeat.json`. Inspect them
directly:

```bash
jq . .orchestrator/status.json
jq . .orchestrator/heartbeat.json
```

The most useful fields are:

- `phase`, `activeTaskId`, `iteration`, and `heartbeatAt`: what the worker is
  doing right now and how fresh that signal is.
- `lastNote` and `lastError`: the last normal transition or failure summary,
  including idle notes about dependency waits and retry waits.
- `retry`: per-task retry records plus `waitingTaskIds`, `exhaustedTaskIds`,
  and the next scheduled retry time.
- `waitingUntil`: when a sleeping worker expects to wake up for the next poll
  or retry window.

## Crash Hardening And Recovery

The standalone loop keeps crash recovery repo-local and file-backed instead of
depending on a separate queue or service.

- Duplicate same-workflow starts fail fast through `worker-<workflow>.lock`
  and `supervisor-<workflow>.lock`.
- Agent exits, runtime errors, dirty integration guards, and integration
  failures keep the task `pending`, persist retry metadata in `state.json`,
  and schedule exponential backoff from `task_failure_backoff_seconds` up to
  `task_failure_retry_limit`.
- Only a worker-emitted `TASK_BLOCKED <task-id>: <reason>` lets the
  orchestrator record `blocked`; automatic retry exhaustion is still visible in
  `progress.md`, `state.json`, and `status.json` while leaving the task
  `pending` for operator review.
- Cherry-pick content conflicts mark a task workspace stale and rebuild it from
  the latest integration branch before rerun. Clean idle workspaces can also be
  refreshed after integration moves forward.
- Workers should not mutate task `Status` lines directly. After successful
  terminal integration, the orchestrator records `done` or `blocked` on the
  integration branch.
- Long-running unattended operation goes through the supervisor, which watches
  `status.json` with a `heartbeat.json` fallback, restarts dead or stalled
  workers, and leaves `supervisor-status.json` behind for inspection.

## Supervisor

Use the supervisor when you want the standalone worker to come back after a
process crash or a stalled runtime heartbeat.

Run the supervisor in the foreground:

```bash
bun run scripts/orchestrator-supervisor.ts run --workflow WORKFLOW.orchestrator.md
```

Start it in the background:

```bash
bun run scripts/orchestrator-supervisor.ts start --workflow WORKFLOW.orchestrator.md
```

Inspect current supervisor and worker state:

```bash
bun run scripts/orchestrator-supervisor.ts status --workflow WORKFLOW.orchestrator.md
jq . .orchestrator/orchestrator-supervisor-status.json
```

Stop the background supervisor and its current worker:

```bash
bun run scripts/orchestrator-supervisor.ts stop --workflow WORKFLOW.orchestrator.md
```

The supervisor polls the worker's `status.json` and falls back to
`heartbeat.json` when needed. It also respects `waitingUntil`, so a worker that
is intentionally sleeping for the next poll or retry window does not look
stalled just because its heartbeat is older.

When the worker finishes all tracked tasks cleanly, the supervisor records a
terminal `completed` state and exits without scheduling a restart.

Set `--stall-seconds` higher than the longest expected uninterrupted task run.
The worker refreshes runtime health at loop transitions, not continuously while
the agent command is still running, so a very aggressive stall timeout will
restart healthy long-running tasks.

## Optional macOS `launchd`

If you want the supervisor to start from a user LaunchAgent on macOS, use the
separate `launchd` helper. Ignore this section on Linux or other environments;
the main worker and supervisor CLIs do not depend on it.

Preview the generated LaunchAgent plist before installing it:

```bash
bun run scripts/orchestrator-launchd.ts print --workflow WORKFLOW.orchestrator.md
```

Install it into `~/Library/LaunchAgents` and load it with `launchctl`:

```bash
bun run scripts/orchestrator-launchd.ts install --workflow WORKFLOW.orchestrator.md
```

Unload the LaunchAgent and remove the plist:

```bash
bun run scripts/orchestrator-launchd.ts uninstall --workflow WORKFLOW.orchestrator.md
```

The generated plist runs `scripts/orchestrator-supervisor.ts run`, sets
`WorkingDirectory` to the repo root, writes `launchd.out.log` and
`launchd.err.log` next to the configured runtime `state_file`, and injects
explicit `PATH` plus `HOME` values into the LaunchAgent environment so `bun`,
`git`, and the configured agent CLI resolve the same way they do from a
terminal session.

The default label is derived from the repo directory plus workflow path. Pass
`--label` if you need a stable custom label, or `--launch-agent-dir` if you do
not want to use the default `~/Library/LaunchAgents` location.

Use the `launchd` helper to stop a LaunchAgent-backed supervisor permanently.
If the LaunchAgent is still loaded, `bun run scripts/orchestrator-supervisor.ts stop`
only stops the current process and `launchd` will start it again on the next
load decision because that service is still installed.

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
- use review-scoped follow-up IDs such as `REVIEW-001-01`
- append review-created tasks as a contiguous block at the end of the relevant
  task doc
- list only reviewed task IDs in `Depends on` so the follow-up stays traceable
  and ready immediately
- prefer review-created follow-up tasks over other same-priority ready work
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
2. Copy `scripts/orchestrator-supervisor.ts` if you want repo-local supervised
   mode.
3. Copy `scripts/orchestrator-launchd.ts` if you want the optional macOS
   LaunchAgent installer.
4. Add a root `WORKFLOW.md` based on `WORKFLOW.orchestrator.md`.
5. Create `docs/tasks.md` and `docs/decisions.md`.
6. Point `task_sources`, `instruction_files`, and `decision_file` at docs that
   make sense for the new project.
7. Set `agent_command` and `agent_args` to the local agent CLI you actually use.
8. Keep runtime output under `.orchestrator/`.
9. Run `bun run scripts/orchestrator.ts --once --dry-run` before the first live
   execution.

What usually stays unchanged:

- `src/orchestrator.ts`
- `scripts/orchestrator.ts`
- `scripts/orchestrator-supervisor.ts` if you use supervised mode
- `scripts/orchestrator-launchd.ts` if you use macOS `launchd`
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
