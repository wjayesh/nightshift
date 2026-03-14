# Mahilo Example

This directory archives the historical Mahilo-specific orchestrator setup that
was carried in the extraction workspace while the standalone orchestrator was
being built.

It is not part of the standalone core surface. The active standalone queue in
this repo lives at `WORKFLOW.orchestrator.md` plus
`docs/tasks-standalone-orchestrator.md`.

Archived example files:

- `examples/mahilo/WORKFLOW.md` for the Mahilo server workflow
- `examples/mahilo/WORKFLOW.plugin.md` for the Mahilo plugin workflow
- `examples/mahilo/docs/autonomous-orchestrator.md` for the old Mahilo
  operator notes
- `examples/mahilo/.codex/skills/mahilo-loop-ops/SKILL.md` for the archived
  repo-local loop-ops skill

These example workflows still point at the Mahilo task docs and runtime paths
in the repo root. They are preserved to show how the orchestrator was used on a
real repo, not as the default way to operate this repository today.

Preview the archived workflows explicitly:

```bash
bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.md --once --dry-run
bun run scripts/orchestrator.ts --workflow examples/mahilo/WORKFLOW.plugin.md --once --dry-run
```
