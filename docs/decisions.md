# Decision Log

Use this file to record consequential implementation decisions that should stay readable after the orchestrator run ends.

## Entry Format

```md
## YYYY-MM-DD - TASK-ID - Short decision title

- Context: What forced the choice?
- Decision: What was chosen and why?
- Impact: What should later readers expect because of it?
```

## 2026-03-10 - ORCH-013 - Add a workflow-configured decision log

- Context: The standalone orchestrator needed a durable place for agents to record key implementation choices without depending on ephemeral terminal output or external tooling.
- Decision: Add a `decision_file` workflow field, point the standalone workflow at this markdown log, and instruct agents to write dated `Context` / `Decision` / `Impact` entries when they make consequential choices.
- Impact: Future runs can inspect implementation reasoning directly in the repo and git history, which makes the orchestrator easier to adopt and audit across tasks.

## 2026-03-10 - ORCH-015 - Make terminal commits explicit and keep push cadence as the real knob

- Context: The extracted standalone workflow still exposed `auto_commit_on_done`, but the runtime always commits terminal `done` or `blocked` work before integration, which made the config misleading.
- Decision: Replace that knob with an explicit `terminal_commit_behavior: per_task` workflow field, keep `auto_push_every_commits` as the adjustable cadence control, and make the final push flush depend only on pending integrated commits plus the push cadence setting.
- Impact: Standalone users now see the intended policy directly in workflow front matter and README docs: each finished task is committed deliberately, while local-vs-remote integration cadence is controlled only by the push threshold.

## 2026-03-10 - ORCH-020 - Document the extraction repo separately from copied-repo defaults

- Context: The root README needed to become the standalone orchestrator setup and adoption guide, but this repo still hosts Mahilo-specific workflows such as the existing root `WORKFLOW.md`, so pretending the extraction workspace already matches the final copied-repo layout would make the instructions inaccurate.
- Decision: Rewrite the README around the standalone workflow that exists today in this repo (`WORKFLOW.orchestrator.md`, `docs/tasks-standalone-orchestrator.md`, and workflow-specific runtime artifact filenames) while explicitly calling out the cleaner target layout for copied repos (`WORKFLOW.md`, `docs/tasks.md`, `docs/decisions.md`, and `.orchestrator/`).
- Impact: The guide stays truthful for this extraction workspace and still teaches the stable copy-into-project mental model that future standalone adopters should use.

## 2026-03-10 - ORCH-030 - Run review passes inside the main loop and persist a review log

- Context: The standalone repo needed automated review cadence, but adding a separate scheduler or review service would widen the surface area and make copied-repo adoption heavier than necessary.
- Decision: Keep reviews inside the existing single-workflow loop, trigger them after every configured batch of completed tasks, run them through the same agent command in either the shared workspace or a dedicated review worktree, and append a markdown review log next to the configured state file before the review commit is integrated.
- Impact: Review cadence stays configurable through `review_every_tasks`, remediation tasks can be inserted directly into task docs at `P0`, `--once` now runs a due review before returning, and repos get a durable review artifact such as `.orchestrator/reviews.md` or `.orchestrator/orchestrator-reviews.md` without introducing another subsystem.

## 2026-03-10 - ORCH-030 - Review completed-task batches from runtime history

- Context: The standalone loop needed a built-in review pass that could run on a fixed cadence, inspect the right recently completed tasks, and persist outcomes durably without introducing a separate service or database.
- Decision: Add a `review_every_tasks` workflow field, track reviewed completion batches in the persisted state, build review prompts from the next unreviewed batch of completed tasks plus their saved last messages, and let the review pass create `P0` remediation tasks directly in the task docs.
- Impact: Standalone workflows now have an explicit review cadence with durable state/progress artifacts and review-generated follow-up work, while older Mahilo-specific workflows can keep review automation disabled by setting `review_every_tasks: 0`.

## 2026-03-10 - ORCH-031 - Make review-created tasks review-scoped and immediately ready

- Context: ORCH-030 let reviews add `P0` remediation tasks, but without a naming scheme, insertion rule, or tie-break policy those follow-ups could look ad hoc and compete ambiguously with ordinary backlog work.
- Decision: Require review-created tasks to use `REVIEW-<review-number>-<sequence>` IDs, append them as a contiguous block at the end of a task doc, restrict `Depends on` to the reviewed task IDs, and have the scheduler prefer those remediation tasks over other same-priority ready work.
- Impact: Review follow-ups are now easy to trace back to a specific review pass, task-doc insertion stays predictable, and urgent remediation work is picked up promptly without adding a second queueing system.

## 2026-03-10 - ORCH-040 - Keep one long-lived worker lock per workflow file

- Context: The standalone loop already had a short-lived `repo.lock` for integration, but it could still start duplicate workers for the same workflow in one repo clone, and the lock location needed to follow workflow runtime configuration instead of repo-specific names.
- Decision: Add a lifetime worker lock under the configured runtime root, derive its filename from the workflow file path, fail fast when that lock is already owned by a live process, and only reclaim stale lock directories when the recorded PID is dead or the lock has aged out without valid owner metadata.
- Impact: Duplicate same-workflow starts now stop immediately with a clear operator message, multiple workflows can coexist when they use distinct runtime artifacts, and stale worker locks can be cleaned up safely without changing the short-lived integration `repo.lock`.

## 2026-03-10 - ORCH-041 - Guard only git-worktree cherry-pick targets

- Context: Task and review worktrees cherry-pick back into one shared integration checkout, so unrelated local edits there can break integration or produce misleading mixed results, while shared-workspace mode commits directly in place and treats local dirt as part of the working set.
- Decision: Before any git-worktree cherry-pick into the shared integration checkout, inspect `git status --porcelain` and fail fast with a concise dirty-path summary, but leave shared-workspace direct commits unchanged.
- Impact: Operators now get a clear cleanup action when the integration checkout is dirty, and shared mode keeps its current direct-commit behavior instead of being blocked by a guard designed for worktree reconciliation.

## 2026-03-10 - ORCH-046 - Keep terminal task status mutations on the orchestrator

- Context: Letting task workers edit `Status` lines directly creates avoidable task-doc conflicts between task branches and the shared integration checkout, especially once the standalone loop is integrating work through a single branch.
- Decision: Make workers report terminal outcomes only through `TASK_DONE` or `TASK_BLOCKED`, revert any worker-side status-line edits before committing task work, and let the orchestrator write `done` or `blocked` to the source task doc on the integration branch after successful terminal integration. When integration already produced a commit, fold the tracker update into that integrated head so normal task completion does not add an extra tracker-only commit.
- Impact: Task source docs now get terminal status only from the orchestrator, blocked tasks with no code changes still land a tracker update on the integration branch, and the shared/git-worktree test coverage now exercises both `done` and `blocked` tracker updates.

## 2026-03-10 - ORCH-042 - Persist per-task retry state and use exponential backoff

- Context: Agent exits, workspace/runtime errors, and integration failures were all terminating the loop immediately, but the standalone repo needs to keep task docs pending and leave enough durable state behind to inspect retries later.
- Decision: Add workflow-level `task_failure_retry_limit` and `task_failure_backoff_seconds` fields, persist consecutive per-task failure records in `state.json`, and schedule retries with a simple exponential backoff from that base delay instead of introducing a separate queue or service.
- Impact: Task failures now stay local to the affected task unless the worker explicitly reports `TASK_BLOCKED`, progress/history entries show whether a retry was scheduled or exhausted, and operators can inspect `taskFailures` in state to see the last failure kind, message, backoff, and next retry time.

## 2026-03-10 - ORCH-047 - Refresh only stale or safely idle task workspaces

- Context: Git-worktree task branches can drift behind the integration branch, and rerunning the agent in the same stale branch after a cherry-pick content conflict just repeats the same failure instead of giving the task a fresh base.
- Decision: Persist a per-task stale-workspace marker in retry state, mark that flag when task-branch cherry-picks hit content conflicts, and rebuild the task worktree from the latest integration branch before rerunning. Also refresh clean task worktrees with no unique commits when the integration branch has moved forward.
- Impact: Conflict retries now discard drifted task branches instead of replaying them forever, idle worktrees stay aligned with the current integration branch, and normal in-progress worktrees with unique commits or pending changes are preserved until the orchestrator explicitly marks them stale.

## 2026-03-10 - ORCH-043 - Derive runtime health files from the configured state file

- Context: Operators and the upcoming supervisor loop need a durable health signal that is easier to poll than the full progress log or state history, but adding new workflow knobs just for file names would widen the standalone surface area.
- Decision: Write sibling `status.json` and `heartbeat.json` files under the configured runtime root, derive their names from `state_file`, and update them at major loop transitions with the current phase, active task, iteration, last note or error, and retry metadata.
- Impact: Repos now get predictable runtime health files such as `.orchestrator/status.json` or `.orchestrator/orchestrator-status.json`, operators can inspect retry/backoff state without digging through `state.json`, and the future supervisor can poll the same heartbeat surface for stall detection.

## 2026-03-10 - ORCH-044 - Keep supervision as a repo-local CLI with status polling

- Context: The standalone repo needed automatic worker restarts plus a clear operator start/stop/status flow, but adding a daemon framework or new workflow configuration surface would make the extracted repo heavier than intended.
- Decision: Add a separate `scripts/orchestrator-supervisor.ts` CLI with `run`, `start`, `stop`, and `status` commands, keep one supervisor lock and `supervisor-status.json` under the workflow runtime root, and detect stalls by polling `status.json` with a fallback to `heartbeat.json` while honoring `waitingUntil` for intentional sleeps.
- Impact: Operators can run one local supervisor per workflow without external services, dead or stalled workers restart automatically, and repos gain a durable supervision artifact; the stall timeout still needs to stay above the longest expected uninterrupted task run because worker heartbeats only advance at loop transitions.

## 2026-03-10 - ORCH-045 - Keep `launchd` as a thin wrapper around the supervisor

- Context: macOS operators need a low-friction way to keep the standalone orchestrator alive across login sessions, but the core worker loop should not grow platform-specific service-management behavior.
- Decision: Add a separate `scripts/orchestrator-launchd.ts` helper that prints, installs, and uninstalls a user LaunchAgent plist for the existing supervisor, with absolute program arguments plus explicit `PATH` and `HOME` environment injection.
- Impact: macOS users can adopt `launchd` without hand-editing plist XML, while non-macOS workflows and the core loop stay unchanged because the platform-specific behavior lives behind an optional helper.

## 2026-03-10 - ORCH-045 - Serialize worker tool calls in orchestrator prompts

- Context: A live `ORCH-045` worker finished the code changes and validations, then stalled without emitting `TASK_DONE` after issuing multiple shell-tool calls in the same turn.
- Decision: Add an explicit prompt rule for both task execution and review passes that requires developer tool calls to run serially, one at a time.
- Impact: Future workers are less likely to deadlock on missing parallel tool responses, and operator intervention should become rarer during long autonomous runs.

## 2026-03-10 - ORCH-044 - Preserve supervisor completion as a terminal state

- Context: The Mahilo 2 supervisor recently fixed a bug where a clean worker completion could still be treated like a restart candidate or be overwritten back to `stopped` in the supervisor status artifact.
- Decision: Port the same completion handling into the standalone extractor by treating a clean worker exit plus terminal completion runtime state as `completed`, then skipping restart/backoff and the final `stopped` overwrite.
- Impact: `supervisor-status.json` now preserves terminal completion accurately, operators can distinguish a finished workflow from a manually stopped one, and the supervisor no longer restarts healthy workers that already finished all tracked tasks.

## 2026-03-10 - ORCH-032 - Keep crash hardening layered and repo-local

- Context: The standalone repo now has the individual hardening pieces from ORCH-040 through ORCH-047, but the product docs still described crash hardening as deferred and did not spell out how the layers fit together.
- Decision: Document crash hardening as one local recovery model: fail fast on duplicate workers, keep non-terminal failures `pending` with durable retry/backoff state, refresh stale task workspaces from the latest integration branch, keep terminal tracker status updates on the orchestrator, and use runtime health artifacts plus a separate supervisor for process restarts.
- Impact: Operators can understand restart and failure behavior from the repo docs alone, copied repos inherit a concrete supervision model without adding external infrastructure, and future hardening work can extend the same runtime artifacts instead of introducing a parallel recovery system.

## 2026-03-10 - ORCH-033 - Keep waiting as a derived pending state

- Context: The standalone docs still described `blocked` as generic waiting, but the runtime already kept retries `pending` and only used `TASK_BLOCKED` for terminal outcomes, which made dependency waits ambiguous.
- Decision: Define dependency waits and retry waits as derived `pending` states surfaced through runtime notes and status artifacts, reserve `blocked` for terminal or manual-intervention outcomes, and treat `dependency_sources` as read-only upstream gates that never schedule work in the current workflow.
- Impact: Operators can distinguish “not ready yet” from true blockage, cross-project dependencies stay one-way and repo-native, and idle runtime notes now explain when the loop is waiting on local, external, or unresolved dependencies.

## 2026-03-10 - ORCH-048 - Dogfood through a replayable temp repo fixture

- Context: Running ORCH-048 directly in the shared repo would mutate the live standalone task tracker and runtime artifacts, but the acceptance criteria needed repeatable review, retry, and stale-workspace scenarios with controlled failures.
- Decision: Validate the task with an automated temp git repo fixture that calls the real standalone CLI, runs in `git_worktree` mode, and scripts deterministic task/review behavior for decision logging, retry backoff, and stale-workspace refresh.
- Impact: The worker loop can now be replayed locally or in CI without polluting the main checkout, operator notes can point to one canonical dogfood command, and supervised restart coverage stays an explicit follow-up instead of being mixed into worker-loop validation.
