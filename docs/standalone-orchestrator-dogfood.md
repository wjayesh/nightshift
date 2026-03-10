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
