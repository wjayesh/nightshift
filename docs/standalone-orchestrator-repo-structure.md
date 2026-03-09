# Standalone Orchestrator Repo Structure

This document defines the target layout for the extracted standalone repo, not the current Mahilo app tree.

The structure stays intentionally small:

- keep the orchestrator engine in one obvious source file
- keep repo-owned configuration and task docs easy to edit by hand
- keep generated runtime artifacts isolated in one hidden directory
- make the copy-into-project boundary obvious

## Canonical Layout

```text
.
|-- README.md
|-- package.json
|-- tsconfig.json
|-- WORKFLOW.md
|-- scripts/
|   `-- orchestrator.ts
|-- src/
|   `-- orchestrator.ts
|-- docs/
|   |-- tasks.md
|   `-- decisions.md
|-- examples/
|   |-- WORKFLOW.example.md
|   |-- tasks.example.md
|   `-- decisions.example.md
`-- .orchestrator/
    |-- progress.md
    |-- state.json
    |-- repo.lock
    |-- <task-id>-last-message.txt
    `-- workspaces/
```

## Core Files

### `README.md`

Setup and adoption guide. This is where copy-into-project usage is explained first.

### `WORKFLOW.md`

Repo-local workflow configuration. It stays at the repo root so the default command path is simple and the file is easy to discover.

Its front matter is the single place to point at:

- task docs
- instruction docs
- runtime artifact paths
- decision log path
- review cadence
- git commit and push cadence

### `src/orchestrator.ts`

Single core implementation file for v1. It owns workflow parsing, task parsing, dependency checks, task selection, runtime artifact writing, workspace management, git integration helpers, and agent execution.

The standalone repo should keep this as one file until code pressure justifies a split. `ORCH-002` is choosing a lean default, not a future-proof package layout.

### `scripts/orchestrator.ts`

Thin CLI entrypoint. It should parse flags, load the workflow, run one loop iteration or continuous mode, and delegate almost all logic to `src/orchestrator.ts`.

### `docs/tasks.md`

Repo-owned task list written in markdown. A copied repo can rename or split task docs later, but the default layout should assume one obvious task file.

### `docs/decisions.md`

Repo-owned decision log. It is a durable artifact that stays readable in git history and easy to inspect without extra tooling.

### `examples/`

Small adoption files for new users. This directory exists so a developer can copy an example workflow and task doc without reading implementation code first.

The directory is part of the target layout even though example content lands in a later task.

### `.orchestrator/`

Generated runtime state and scratch space:

- `progress.md` for append-only iteration history
- `state.json` for persisted loop state
- `repo.lock` for short integration-branch locking
- `<task-id>-last-message.txt` for per-task terminal agent output
- `workspaces/` for shared or git-worktree task workspaces

The extracted repo should standardize on `.orchestrator/` instead of `.mahilo-orchestrator/` so copied repos do not inherit Mahilo-specific naming.

## Copy-Into-Project Boundary

The structure is designed so a user can reason about three groups of files:

- copy mostly unchanged: `src/orchestrator.ts`, `scripts/orchestrator.ts`, `package.json`, `tsconfig.json`
- edit per repo: `WORKFLOW.md`, task docs under `docs/`, instruction docs, and the decision log path
- generated at runtime: everything under `.orchestrator/`

That boundary keeps adoption simple. Engine files stay stable, repo policy stays in markdown, and runtime artifacts stay durable without mixing into product source directories.

## Explicit Non-Structure Decisions

To keep the layout lean, the standalone repo should not introduce these in v1:

- a server process or dashboard directory
- a plugin system directory
- a database or remote state service
- a large internal package split for parser, scheduler, git, and runtime helpers

If those become necessary later, they should be added only after the minimal copy-into-project shape has proven too small.
