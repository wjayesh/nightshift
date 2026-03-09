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
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-010

Create a standalone CLI entrypoint around the orchestrator core.

**Acceptance Criteria**

- [ ] Continuous mode works
- [ ] `--once` works
- [ ] `--dry-run` works
- [ ] Workflow file selection works

### 1.3 Preserve runtime artifacts

- **ID**: `ORCH-012`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-010

Preserve the current durable runtime artifacts as first-class features.

**Acceptance Criteria**

- [ ] Progress file support exists
- [ ] State file support exists
- [ ] Per-task last-message capture exists
- [ ] README explains why these files exist

### 1.4 Add decision doc support

- **ID**: `ORCH-013`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-010

Add first-class decision logging so agents can record key implementation choices durably.

**Acceptance Criteria**

- [ ] Workflow can declare a decision doc location
- [ ] Agent instructions mention updating the decision doc
- [ ] Decision entries are easy to read later
- [ ] README explains the purpose of the decision doc

### 1.5 Preserve dependency-aware scheduling

- **ID**: `ORCH-014`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-010

Keep doc-based dependency ordering as a core feature.

**Acceptance Criteria**

- [ ] `Depends on` metadata is supported
- [ ] Cross-doc dependency sources are supported
- [ ] Behavior is tested

### 1.6 Preserve git integration cadence

- **ID**: `ORCH-015`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-010

Preserve and clarify the commit/push cadence behavior for standalone use.

**Acceptance Criteria**

- [ ] Per-task terminal commit behavior is documented or configurable
- [ ] Push cadence is configurable
- [ ] Workflow config exposes cadence clearly
- [ ] README explains the recommended defaults

## Phase 2 - Adoption

### 2.1 Write setup and usage guide

- **ID**: `ORCH-020`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-011, ORCH-012, ORCH-013, ORCH-014, ORCH-015

Write a README that explains setup, workflow files, task docs, runtime artifacts, and how to copy the repo into a new project.

**Acceptance Criteria**

- [ ] README explains the core mental model
- [ ] README includes quick start steps
- [ ] README explains how to adapt the orchestrator in a new repo
- [ ] README explains decision docs
- [ ] README explains review cadence
- [ ] README explains commit/push cadence

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
