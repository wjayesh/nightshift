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
- **Status**: `done`
- **Priority**: P1
- **Depends on**: ORCH-020
- **Notes**:
  - 2026-03-10: Added `examples/WORKFLOW.example.md`, `examples/tasks.example.md`, and `examples/decisions.example.md` as a small billing-report export adoption example for copied repos.
  - 2026-03-10: Validation passed with `node node_modules/prettier/bin/prettier.cjs --check README.md examples/WORKFLOW.example.md examples/tasks.example.md examples/decisions.example.md docs/tasks-standalone-orchestrator.md` and a `bun -e` parser smoke test for the example workflow/task docs.

Provide small example files that show how a new repo would adopt the orchestrator.

**Acceptance Criteria**

- [x] Example workflow exists
- [x] Example task doc exists
- [x] Examples are small and realistic

## Phase 3 - Planned Enhancements

### 3.1 Build periodic review loop

- **ID**: `ORCH-030`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-020
- **Notes**:
  - 2026-03-10: Started implementing configurable periodic review scheduling, durable review outcomes, and review-created remediation task insertion in the standalone loop.
  - 2026-03-10: Added `review_every_tasks` workflow parsing/defaults, review batching from persisted completion history, synthetic review prompts that inspect the next completed-task batch plus saved last messages, and durable review records in state/progress plus per-review last-message files.
  - 2026-03-10: Validation passed with `bun test tests/unit/orchestrator.test.ts tests/unit/orchestrator-runtime-artifacts.test.ts tests/unit/orchestrator-review-loop.test.ts` and `node node_modules/prettier/bin/prettier.cjs --check src/orchestrator.ts tests/unit/orchestrator.test.ts tests/unit/orchestrator-review-loop.test.ts README.md WORKFLOW.orchestrator.md WORKFLOW.md WORKFLOW.plugin.md docs/autonomous-orchestrator.md docs/decisions.md docs/tasks-standalone-orchestrator.md`.

Add a built-in review pass that runs after a configurable number of completed tasks.

**Acceptance Criteria**

- [x] Review cadence is configurable
- [x] Recommended default is documented
- [x] Reviewer inspects the last N completed tasks
- [x] Reviewer can create new high-priority remediation tasks
- [x] Review outcomes are persisted clearly

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
- **Depends on**: ORCH-040, ORCH-041, ORCH-042, ORCH-043, ORCH-044, ORCH-045, ORCH-046, ORCH-047
- **Notes**:
  - 2026-03-10: Expanded the broad crash-hardening goal into concrete runtime tasks `ORCH-040` through `ORCH-045` after reviewing the hardened Mahilo 2 orchestrator behavior.
  - 2026-03-10: Added `ORCH-046` and `ORCH-047` after reviewing the Mahilo 2 stale-branch fix; the standalone hardening umbrella now also includes tracker-owned status updates and stale workspace refresh recovery.

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

## Phase 4 - Runtime Hardening

### 4.1 Add workflow-scoped worker lock

- **ID**: `ORCH-040`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-011
- **Notes**:
  - 2026-03-10: Started adding a long-lived workflow worker lock under the configured runtime root so duplicate same-workflow starts fail fast while stale locks are cleaned up safely.
  - 2026-03-10: Added a lifetime worker lock keyed by workflow file under the configured runtime root, kept `repo.lock` short-lived for integration only, and covered duplicate-start plus stale-lock recovery with focused CLI tests.
  - 2026-03-10: Validation passed with `bun test tests/unit/orchestrator.test.ts tests/unit/orchestrator-cli.test.ts tests/unit/orchestrator-runtime-artifacts.test.ts` and `node node_modules/prettier/bin/prettier.cjs --write src/orchestrator.ts tests/unit/orchestrator-cli.test.ts README.md docs/decisions.md docs/tasks-standalone-orchestrator.md`.

Prevent duplicate standalone workers for the same workflow in the same repo clone.

**Acceptance Criteria**

- [x] A workflow-scoped worker lock exists for the lifetime of the loop process
- [x] The lock path is derived from the configured runtime root rather than hard-coded repo names
- [x] Stale worker locks are cleaned up safely
- [x] Duplicate same-workflow starts fail fast with a clear operator-facing error

### 4.2 Guard dirty integration checkouts

- **ID**: `ORCH-041`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-010
- **Notes**:
  - 2026-03-10: Added a git-worktree-only dirty checkout guard before cherry-pick for both terminal-task and review integrations, and shaped the operator-facing error around the dirty paths reported by `git status --porcelain`.
  - 2026-03-10: Added focused coverage in `tests/unit/orchestrator-git-integration.test.ts` for dirty git-worktree integration failure and shared-workspace direct-commit behavior.
  - 2026-03-10: Validation passed with `bun test tests/unit/orchestrator.test.ts tests/unit/orchestrator-runtime-artifacts.test.ts tests/unit/orchestrator-review-loop.test.ts tests/unit/orchestrator-git-integration.test.ts` and `node node_modules/prettier/bin/prettier.cjs --check src/orchestrator.ts tests/unit/orchestrator-git-integration.test.ts docs/decisions.md docs/tasks-standalone-orchestrator.md`.

Refuse git-worktree integration when the shared integration checkout has uncommitted changes.

**Acceptance Criteria**

- [x] Git-worktree integration checks the shared checkout for pending changes before cherry-pick
- [x] Failure messages summarize the dirty paths clearly
- [x] Shared-workspace direct-commit mode is not blocked by this guard
- [x] Behavior is covered by focused tests

### 4.2a Move tracker status updates into the orchestrator

- **ID**: `ORCH-046`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: ORCH-011
- **Notes**:
  - 2026-03-10: Port the Mahilo 2 fix that stops task workers from editing tracker status metadata directly and makes the orchestrator record `done` or `blocked` on the integration branch after successful integration.
  - 2026-03-10: Updated task prompts to forbid worker status-line edits, reverted any worker tracker-status mutations before task commits, and made the orchestrator record terminal `done` or `blocked` on the integration branch after terminal integration.
  - 2026-03-10: Validation passed with `bun test tests/unit/orchestrator.test.ts tests/unit/orchestrator-review-loop.test.ts tests/unit/orchestrator-git-integration.test.ts` and `node node_modules/prettier/bin/prettier.cjs --check src/orchestrator.ts tests/unit/orchestrator.test.ts tests/unit/orchestrator-git-integration.test.ts docs/tasks-standalone-orchestrator.md docs/decisions.md`.

Make the orchestrator, not the worker, responsible for task status mutations in the task source docs.

**Acceptance Criteria**

- [x] Task prompts explicitly forbid worker edits to task-tracker status metadata
- [x] Successful terminal integration updates the source task status on the integration branch
- [x] Tracker updates work for both `done` and `blocked` outcomes
- [x] Focused tests cover the tracker update path

### 4.3 Add non-fatal retries and backoff

- **ID**: `ORCH-042`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-011

Keep runtime, agent, and integration failures from killing the whole loop on the first error.

**Acceptance Criteria**

- [ ] Workflow config supports task failure retry limit and backoff settings
- [ ] Agent, runtime, and integration failures leave the task `pending` unless the worker explicitly says `TASK_BLOCKED`
- [ ] Retry timing and failure counts are persisted in orchestrator state
- [ ] Progress and state make retry behavior easy to inspect later

### 4.3a Refresh stale task workspaces and recover from conflict

- **ID**: `ORCH-047`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-042, ORCH-046
- **Notes**:
  - 2026-03-10: Port the Mahilo 2 stale-worktree fix that refreshes task branches from the latest integration branch and treats cherry-pick content conflicts as workspace-refresh recovery instead of generic retry.

Refresh stale task branches from the latest integration branch instead of rerunning the same drifted workspace forever.

**Acceptance Criteria**

- [ ] The orchestrator can remove and recreate a task workspace from the latest integration branch when marked stale
- [ ] Cherry-pick content conflicts mark the workspace stale and schedule a rerun on a fresh base instead of repeating the same stale retry
- [ ] Idle task workspaces with no unique commits or pending changes can be refreshed when integration moves forward
- [ ] Focused tests cover conflict-triggered refresh and rerun behavior

### 4.4 Add runtime heartbeat and status files

- **ID**: `ORCH-043`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-042

Expose durable runtime health signals for operators and future supervision.

**Acceptance Criteria**

- [ ] A runtime status file exists under the configured runtime root
- [ ] Heartbeats include current phase, active task, iteration, and last note or error
- [ ] Retry metadata is exposed in the runtime status file
- [ ] README explains how to inspect runtime health

### 4.5 Add standalone supervisor

- **ID**: `ORCH-044`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-040, ORCH-042, ORCH-043

Add a lightweight supervisor that restarts the standalone worker when it dies or stalls.

**Acceptance Criteria**

- [ ] A supervisor starts and watches the standalone orchestrator process
- [ ] The supervisor restarts the worker after process death or runtime stall
- [ ] Stall detection reads the runtime heartbeat or status file
- [ ] Operator docs cover the start, stop, and status flow

### 4.6 Add optional `launchd` support

- **ID**: `ORCH-045`
- **Status**: `pending`
- **Priority**: P0
- **Depends on**: ORCH-044

Provide an optional macOS `launchd` installer without making it a core requirement.

**Acceptance Criteria**

- [ ] `launchd` support is optional and separate from the core loop
- [ ] Generated plist content captures the required `PATH` and `HOME`
- [ ] Install and uninstall docs exist for macOS operators
- [ ] Non-macOS workflows remain unaffected
