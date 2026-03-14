# Mahilo Autonomous Orchestrator

> Historical Mahilo example: this document was moved under `examples/mahilo/`
> to show how the orchestrator was used inside Mahilo during extraction. It is
> not part of the standalone core surface.

Mahilo used an in-repo autonomous development loop inspired by Symphony, but
backed by markdown task lists instead of Linear.

## Goals

- keep task tracking in-repo
- dispatch one ready task at a time
- keep agent work focused on a single task
- support persistent progress and repeatable runs
- isolate task work with native git worktrees when desired
- keep `main` clean by reconciling into an integration branch

## Archived Mahilo Source of Truth

- `examples/mahilo/WORKFLOW.md` is the archived **server** workflow
- `examples/mahilo/WORKFLOW.plugin.md` is the archived plugin workflow
- `docs/prd-server-policy-platform.md` is the server task source
- `docs/prd-openclaw-plugin-migration.md` is the plugin task source
- `docs/openclaw-plugin-server-contract.md` is the shared server/plugin
  contract

## How It Works

1. Load a workflow file.
2. Parse task docs for task IDs, statuses, priorities, and dependencies.
3. Optionally parse separate dependency sources as read-only docs to gate tasks
   on external prerequisites.
4. Pick the next ready task.
5. Create or reuse a task-specific git worktree branch.
6. Run `codex exec` with the workflow prompt plus the assigned task section.
7. Leave in-progress changes inside the task branch worktree until the worker
   reports a terminal outcome or exits without completing it.
8. When the worker reports `TASK_DONE` or `TASK_BLOCKED`, commit that work in
   the task branch.
9. Acquire a short repo-level lock only for integration-branch mutation.
10. Refuse git-worktree integration when the shared integration checkout is
    dirty, and refresh stale task workspaces from the latest integration branch
    when retry recovery marks them stale.
11. Cherry-pick the new task-branch commit(s) into the shared integration
    branch.
12. Let the orchestrator write terminal `done` or `blocked` status to the
    source task doc on the integration branch after successful terminal
    integration.
13. Auto-push after every configured commit threshold, and on final completion.
14. After every configured batch of completed tasks, run a review pass against
    the last batch and let the reviewer add high-priority remediation tasks
    when needed, using review-scoped IDs, end-of-doc insertion, and
    dependencies on the reviewed tasks only.
15. Re-read the task docs on the integration branch to see whether the task
    moved to `done`, `blocked`, or remains active.
16. Repeat until all tracked tasks are complete or the loop limit is reached.

## Waiting Semantics

- Unmet `Depends on` keeps a task `pending`; waiting is derived from readiness,
  not a separate task-doc status.
- `dependency_sources` are read-only prerequisites. They can block current
  workflow tasks, but the current workflow never dispatches or rewrites those
  external tasks.
- Agent, runtime, and integration retry backoff also keep tasks `pending`.
- `blocked` is reserved for worker-reported terminal or manual-intervention
  outcomes.
- Idle `progress.md` and `status.json` notes should explain whether the loop is
  waiting on a local dependency, an external dependency, an unresolved
  dependency ID, or a retry window.

## Files

- `src/orchestrator.ts` — parser, scheduler, dependency resolver,
  git-worktree manager, git integration helpers, and agent runner
- `scripts/orchestrator.ts` — CLI entrypoint and runtime loop
- `scripts/orchestrator-supervisor.ts` — lightweight repo-local supervisor that
  restarts dead or stalled workers
- `scripts/orchestrator-launchd.ts` — optional macOS LaunchAgent wrapper around
  the supervisor
- `scripts/ralph.sh` — compatibility wrapper that now calls the new
  orchestrator
- `.mahilo-orchestrator/state.json` — persisted server runtime state
- `.mahilo-orchestrator/progress.md` — server iteration log
- `.mahilo-orchestrator/*status*.json` and `*heartbeat*.json` — workflow-
  specific runtime health artifacts for operator inspection and stall detection
- `.mahilo-orchestrator/*supervisor-status*.json` — durable supervisor state
  when supervised mode is running
- `.mahilo-orchestrator/plugin-state.json` — persisted plugin runtime state
- `.mahilo-orchestrator/plugin-progress.md` — plugin iteration log

## Safety and Git Behavior

- Workflows guard the current checkout branch by default, and `required_branch`
  is now just the optional explicit pin when an operator wants one.
- The loop reconciles into the integration branch, never directly into `main`.
- Each completed or blocked terminal task is committed in its own task branch
  before integration.
- The integration branch stays linear by cherry-picking task commits instead of
  merging task branches.
- The loop auto-pushes after every 3 integrated task commits by default.
- Concurrent workflows share a repo-level lock only around cherry-pick and push
  operations.
- The plugin workflow is scoped away from server implementation files to reduce
  overlap.

## Crash Hardening

- Workflow-scoped worker locks prevent duplicate same-workflow starts in one
  repo clone.
- Agent, runtime, and integration failures are retried with persisted backoff
  instead of killing the whole loop, and tasks stay `pending` unless the worker
  explicitly reports `TASK_BLOCKED`.
- The orchestrator, not the worker, records terminal task `Status` updates on
  the integration branch after successful terminal integration.
- Cherry-pick content conflicts mark the task workspace stale and rebuild it
  from the latest integration branch before rerun.
- Runtime `status.json` and `heartbeat.json` files provide durable health
  snapshots for operators and for stall detection.
- `scripts/orchestrator-supervisor.ts` can restart dead or stalled workers, and
  `scripts/orchestrator-launchd.ts` optionally wraps that supervisor for macOS
  LaunchAgents.

## Commands

```bash
bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.md
bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.md --once
bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.md --once --dry-run
bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.plugin.md --once --dry-run
```

## Current Limitations

- Task parsing expects the current PRD format with `ID`, `Status`, `Priority`,
  and `Depends on` metadata lines.
- The orchestrator uses one active task at a time per workflow.
- Worktree cleanup is manual for now.
- The loop does not yet manage multiple parallel agents within a single
  workflow.
