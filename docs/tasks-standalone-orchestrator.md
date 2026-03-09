# Standalone Orchestrator Tasks

> **Status**: Planning

This task list is for extracting the current Mahilo orchestration approach into a lean standalone repo.

## Status Values

| Status        | Meaning                   |
| ------------- | ------------------------- |
| `pending`     | Not started               |
| `in-progress` | Currently being worked on |
| `blocked`     | Waiting on something      |
| `review`      | Ready for review          |
| `done`        | Finished                  |

## Phase 0 - Repo Definition

### 0.1 Define standalone repo scope

- **ID**: `ORCH-001`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: None
- **Notes**:
  - 2026-03-09: Defined the standalone repo mission, lean v1 scope, explicit value add over Symphony, copy-into-project adoption model, and deferred repo-structure decisions to `ORCH-002`.

Clarify the standalone repo's mission, value add over Symphony, non-goals, and adoption model.

**Acceptance Criteria**

- [ ] A product spec exists for the standalone repo
- [ ] The scope is intentionally lean
- [ ] Value add over base Symphony is explicit

### 0.2 Define repo structure

- **ID**: `ORCH-002`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-001
- **Notes**:
  - 2026-03-09: Defined the target extracted repo layout in `docs/standalone-orchestrator-repo-structure.md` around a single core module, a thin CLI, repo-owned workflow/docs, and a generic `.orchestrator/` runtime directory.
  - 2026-03-09: Validation passed with `node node_modules/prettier/bin/prettier.cjs --check docs/standalone-orchestrator-repo-structure.md docs/tasks-standalone-orchestrator.md`.

Choose the minimal file and folder layout for the standalone repo.

**Acceptance Criteria**

- [x] Repo structure is documented
- [x] Core files are identified
- [x] Copy-into-project usage is supported by the structure

## Phase 1 - Extraction

### 1.1 Extract orchestrator core

- **ID**: `ORCH-010`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-002
- **Notes**:
  - 2026-03-09: Started extracting standalone core defaults and removing hard-coded Mahilo runtime assumptions from the shared orchestrator engine.
  - 2026-03-09: Switched the core default workflow layout to `docs/tasks.md` plus `.orchestrator/`, widened task heading parsing for reusable markdown docs, and routed runtime locks/last-message artifacts through the configured runtime root instead of hard-coded Mahilo paths.
  - 2026-03-09: Validation passed with `bun test tests/unit/orchestrator.test.ts` and `node node_modules/prettier/bin/prettier.cjs --check src/orchestrator.ts scripts/orchestrator.ts tests/unit/orchestrator.test.ts docs/tasks-standalone-orchestrator.md WORKFLOW.orchestrator.md`.

Move the generic orchestration logic into a standalone repo layout with minimal Mahilo-specific coupling.

**Acceptance Criteria**

- [x] Core workflow parsing exists
- [x] Core task parsing exists
- [x] Scheduler logic is standalone
- [x] Mahilo-specific assumptions are removed or isolated

### 1.2 Extract CLI entrypoint

- **ID**: `ORCH-011`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-010
- **Notes**:
  - 2026-03-09: Started extracting the runtime loop behind exported core helpers so `scripts/orchestrator.ts` can shrink to a standalone CLI wrapper with explicit `--once`, `--dry-run`, and workflow selection behavior.
  - 2026-03-09: Moved the loop, lock handling, integration helpers, and CLI arg parsing into `src/orchestrator.ts`; reduced `scripts/orchestrator.ts` to a thin wrapper; and added end-to-end CLI tests covering continuous mode, `--once`, `--dry-run`, and `--workflow`.
  - 2026-03-09: Validation passed with `bun test tests/unit/orchestrator.test.ts tests/unit/orchestrator-cli.test.ts` and `node node_modules/prettier/bin/prettier.cjs --check src/orchestrator.ts scripts/orchestrator.ts tests/unit/orchestrator-cli.test.ts docs/tasks-standalone-orchestrator.md`. Repo-wide `node node_modules/typescript/bin/tsc --noEmit` still fails because `tsconfig.json` sets `rootDir: ./src` while including `tests/**/*.ts`.

Create a standalone CLI entrypoint around the orchestrator core.

**Acceptance Criteria**

- [x] Continuous mode works
- [x] `--once` works
- [x] `--dry-run` works
- [x] Workflow file selection works

### 1.3 Preserve runtime artifacts

- **ID**: `ORCH-012`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-010
- **Notes**:
  - 2026-03-10: Auditing the extracted standalone core to lock progress, state, and per-task last-message artifacts in place with explicit tests and README documentation.
  - 2026-03-10: Confirmed standalone progress/state writing plus per-task last-message capture with dedicated unit coverage and documented the runtime artifacts in `README.md`.
  - 2026-03-10: Validation passed with `bun test tests/unit/orchestrator.test.ts tests/unit/orchestrator-runtime-artifacts.test.ts` and `node node_modules/prettier/bin/prettier.cjs --check README.md docs/tasks-standalone-orchestrator.md tests/unit/orchestrator-runtime-artifacts.test.ts`.

Preserve the current durable runtime artifacts as first-class features.

**Acceptance Criteria**

- [x] Progress file support exists
- [x] State file support exists
- [x] Per-task last-message capture exists
- [x] README explains why these files exist

### 1.4 Add decision doc support

- **ID**: `ORCH-013`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-010
- **Notes**:
  - 2026-03-10: Wiring a workflow-level decision doc path into the standalone prompt surface, adding a durable markdown decision log template, and documenting the decision log behavior in the README.
  - 2026-03-10: Added `decision_file` workflow parsing/defaults, pointed `WORKFLOW.orchestrator.md` at `docs/decisions.md`, seeded a readable decision log template with an initial ORCH-013 entry, and updated the task prompt to explicitly require decision doc updates for consequential choices.
  - 2026-03-10: Validation passed with `bun test tests/unit/orchestrator.test.ts` and `node node_modules/prettier/bin/prettier.cjs --check src/orchestrator.ts tests/unit/orchestrator.test.ts README.md WORKFLOW.orchestrator.md docs/decisions.md docs/tasks-standalone-orchestrator.md`.

Add first-class decision logging so agents can record key implementation choices durably.

**Acceptance Criteria**

- [x] Workflow can declare a decision doc location
- [x] Agent instructions mention updating the decision doc
- [x] Decision entries are easy to read later
- [x] README explains the purpose of the decision doc

### 1.5 Preserve dependency-aware scheduling

- **ID**: `ORCH-014`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-010
- **Notes**:
  - 2026-03-10: Auditing the standalone scheduler to prove `Depends on` parsing and workflow-level `dependency_sources` gating with focused tests.
  - 2026-03-10: Confirmed the extracted scheduler still honors comma-separated `Depends on` metadata, blocks unfinished cross-doc prerequisites, and consumes workflow `dependency_sources` during real CLI task selection without additional core changes.
  - 2026-03-10: Validation passed with `bun test tests/unit/orchestrator.test.ts tests/unit/orchestrator-cli.test.ts` and `node node_modules/prettier/bin/prettier.cjs --check tests/unit/orchestrator.test.ts tests/unit/orchestrator-cli.test.ts docs/tasks-standalone-orchestrator.md`.

Keep doc-based dependency ordering as a core feature.

**Acceptance Criteria**

- [x] `Depends on` metadata is supported
- [x] Cross-doc dependency sources are supported
- [x] Behavior is tested

### 1.6 Preserve git integration cadence

- **ID**: `ORCH-015`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-010
- **Notes**:
  - 2026-03-10: Auditing the extracted standalone git integration flow to replace the misleading `auto_commit_on_done` knob with explicit terminal-commit documentation/config, keep push cadence configurable, and document recommended standalone defaults.
  - 2026-03-10: Replaced the misleading standalone commit toggle with `terminal_commit_behavior: per_task`, kept `auto_push_every_commits` as the adjustable cadence control, documented recommended defaults in `README.md`, and ensured final push flushing depends only on pending integrated commits plus push cadence.
  - 2026-03-10: Validation passed with `bun test tests/unit/orchestrator.test.ts tests/unit/orchestrator-cli.test.ts` and `node node_modules/prettier/bin/prettier.cjs --check src/orchestrator.ts tests/unit/orchestrator.test.ts tests/unit/orchestrator-cli.test.ts README.md WORKFLOW.orchestrator.md WORKFLOW.md WORKFLOW.plugin.md docs/decisions.md docs/tasks-standalone-orchestrator.md`.

Preserve and clarify the commit/push cadence behavior for standalone use.

**Acceptance Criteria**

- [x] Per-task terminal commit behavior is documented or configurable
- [x] Push cadence is configurable
- [x] Workflow config exposes cadence clearly
- [x] README explains the recommended defaults

## Phase 2 - Adoption

### 2.1 Write setup and usage guide

- **ID**: `ORCH-020`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-011, ORCH-012, ORCH-013, ORCH-014, ORCH-015
- **Notes**:
  - 2026-03-10: Started rewriting the root README into a standalone orchestrator guide that explains setup, workflow/task docs, runtime artifacts, adoption into a new repo, decision logging, review cadence, and git integration cadence.
  - 2026-03-10: Replaced the mixed registry/standalone root README with a standalone guide that explains the core mental model, current extraction-repo commands, workflow/task doc structure, runtime artifacts, decision logging, review cadence expectations, commit/push cadence, and the copy-into-project boundary for a future standalone repo.
  - 2026-03-10: Validation passed with `node node_modules/prettier/bin/prettier.cjs --check README.md docs/decisions.md docs/tasks-standalone-orchestrator.md` and `bun run scripts/orchestrator.ts --help`.

Write a README that explains setup, workflow files, task docs, runtime artifacts, and how to copy the repo into a new project.

**Acceptance Criteria**

- [x] README explains the core mental model
- [x] README includes quick start steps
- [x] README explains how to adapt the orchestrator in a new repo
- [x] README explains decision docs
- [x] README explains review cadence
- [x] README explains commit/push cadence

### 2.2 Add example workflow and task docs

- **ID**: `ORCH-021`
- **Status**: `pending`
- **Priority**: P1
- **Depends on**: ORCH-020

Provide small example files that show how a new repo would adopt the orchestrator.

**Acceptance Criteria**

- [ ] Example workflow exists
- [ ] Example task doc exists
- [ ] Examples are small and realistic

## Phase 3 - Planned Enhancements

### 3.1 Build periodic review loop

- **ID**: `ORCH-030`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-020

Add a built-in review pass that runs after a configurable number of completed tasks.

**Acceptance Criteria**

- [ ] Review cadence is configurable
- [ ] Recommended default is documented
- [ ] Reviewer inspects the last N completed tasks
- [ ] Reviewer can create new high-priority remediation tasks
- [ ] Review outcomes are persisted clearly

### 3.2 Define review-created task behavior

- **ID**: `ORCH-031`
- **Status**: `pending`
- **Priority**: P1
- **Depends on**: ORCH-030

Define how reviewer-created follow-up tasks are inserted and prioritized.

**Acceptance Criteria**

- [ ] New review tasks have a clear ID scheme
- [ ] New review tasks are inserted predictably
- [ ] Priority behavior is defined
- [ ] Dependency behavior is defined

### 3.3 Add crash hardening

- **ID**: `ORCH-032`
- **Status**: `pending`
- **Priority**: P1
- **Depends on**: ORCH-011

Add restart-friendly supervision for long-running loops.

**Acceptance Criteria**

- [ ] Recovery strategy is documented
- [ ] Process supervision approach is defined
- [ ] Failure behavior is explicit

### 3.4 Add richer waiting semantics

- **ID**: `ORCH-033`
- **Status**: `pending`
- **Priority**: P1
- **Depends on**: ORCH-014

Design explicit waiting semantics for dependencies that cannot run yet.

**Acceptance Criteria**

- [ ] Waiting behavior is documented
- [ ] Status model is defined
- [ ] Cross-project dependency direction is clarified
