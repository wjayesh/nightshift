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
