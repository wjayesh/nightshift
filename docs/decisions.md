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
