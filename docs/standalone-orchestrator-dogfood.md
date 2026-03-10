# Standalone Orchestrator Dogfood Notes

## 2026-03-10 Worker-Loop Fixture

- Validation command: `bun test tests/integration/orchestrator-dogfood.test.ts`
- Runtime shape: temp git repo, `workspace_mode: git_worktree`, `review_every_tasks: 2`, `task_failure_retry_limit: 3`, `task_failure_backoff_seconds: 5`
- Fixture queue: `DOG-001` through `DOG-004`, plus review-created remediation task `REVIEW-001-01`

## What Worked

- `DOG-001` and `DOG-003` both wrote tracked decision-log entries, so the run validated that task-branch changes can update `docs/decisions.md` and still integrate cleanly on the shared branch.
- The run produced the expected worker artifacts under `.orchestrator/runtime/`: `progress.md`, `state.json`, `status.json`, `heartbeat.json`, and per-task / per-review last-message files.
- `DOG-002` failed once, stayed `pending`, logged `retry_scheduled`, idled on the retry window, and then recovered on the next run.
- `review-001` created `REVIEW-001-01`, and the scheduler picked that remediation task before later ready work. `review-002` then ran against the next completed batch and closed without creating more work.
- `DOG-004` started from a pre-seeded stale worktree, hit a cherry-pick content conflict, marked the workspace stale, refreshed from the latest integration head, and completed on rerun.

## What Failed

- No core worker-loop regressions were found in this fixture.
- The run still exposed a coverage gap: it validates the worker loop directly, but it does not invoke `scripts/orchestrator-supervisor.ts` or `scripts/orchestrator-launchd.ts`, so live restart behavior is still outside the dogfood path.

## Manual Validation Still Needed

- Run the same fixture under `scripts/orchestrator-supervisor.ts` and force both a dead child and a stalled child so restart behavior is proven against real runtime files instead of only unit tests.
- After supervised dogfood exists, do one manual macOS `launchd` install/uninstall cycle to confirm the wrapper behaves correctly around a long-running standalone workflow.

## 2026-03-10 Supervised Fixture

- Validation command: `bun test tests/integration/orchestrator-supervised-dogfood.test.ts`
- Runtime shape: temp git repo, `workspace_mode: git_worktree`, `review_every_tasks: 0`, `poll_interval_seconds: 3`, supervisor `--stall-seconds 2 --check-interval-seconds 1 --restart-delay-seconds 0`
- Fixture queue: `DOG-SUP-001` through `DOG-SUP-003`

## What Worked Under Supervision

- The fixture ran through the real `scripts/orchestrator-supervisor.ts` entrypoint instead of calling the worker loop directly, so `supervisor-status.json`, `status.json`, and `heartbeat.json` all came from live child processes.
- After `DOG-SUP-001` completed and the worker entered a normal sleep window, the drill killed the worker PID explicitly. The supervisor observed the dead child, restarted it, and preserved the restart reason in `supervisor-status.json`.
- `DOG-SUP-002` hung on its first run, which left `status.json` and `heartbeat.json` pinned on `phase: running_task` for that task. The supervisor detected that stale runtime health, terminated the stalled worker, restarted it, and the second run completed cleanly.
- The fixture exited with supervisor state `completed`, all three tasks marked `done`, durable runtime artifacts present under `.orchestrator/runtime/`, and launchd plist generation working against the same workflow through `scripts/orchestrator-launchd.ts print`.

## Supervisor-Specific Gaps

- The stall drill still uses a synthetic hanging agent, so operators should keep `--stall-seconds` above the longest expected uninterrupted agent step in a real repo; otherwise a healthy long-running task can still look stalled because worker heartbeats only advance at loop transitions.
- The dead-worker drill uses an explicit `SIGKILL`, which proves restart handling and lock cleanup, but it does not replace normal operator inspection of `progress.md`, `status.json`, and `supervisor-status.json` when a real crash has partial stderr output.

## `launchd` Status

- Automated validation for ORCH-049 only prints the LaunchAgent plist for the supervised dogfood workflow. That keeps the task cross-platform while still proving that the wrapper points at the supervisor script, workflow file, and runtime log paths.
- A real macOS `launchd` install/uninstall cycle remains optional manual validation and should be run from a macOS checkout when an operator wants long-lived personal supervision.
