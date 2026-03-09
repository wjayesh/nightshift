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

## 2026-03-10 - ORCH-040 - Keep one long-lived worker lock per workflow file

- Context: The standalone loop already had a short-lived `repo.lock` for integration, but it could still start duplicate workers for the same workflow in one repo clone, and the lock location needed to follow workflow runtime configuration instead of repo-specific names.
- Decision: Add a lifetime worker lock under the configured runtime root, derive its filename from the workflow file path, fail fast when that lock is already owned by a live process, and only reclaim stale lock directories when the recorded PID is dead or the lock has aged out without valid owner metadata.
- Impact: Duplicate same-workflow starts now stop immediately with a clear operator message, multiple workflows can coexist when they use distinct runtime artifacts, and stale worker locks can be cleaned up safely without changing the short-lived integration `repo.lock`.
