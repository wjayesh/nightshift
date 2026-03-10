# Standalone Orchestrator Product Spec

## Mission

Build a small, repo-native autonomous coding orchestrator that can be copied into a new project, pointed at markdown task docs, and made useful with minimal edits.

The standalone repo exists to preserve the durable parts of the current Mahilo orchestration model without dragging along Mahilo-specific product assumptions.

## Problem

The current Mahilo orchestrator already solves a real workflow problem:

- keep planning and execution inside the repo
- pick the next ready task using doc-defined dependencies
- leave durable runtime artifacts behind
- integrate finished work on an explicit git cadence

That behavior is useful outside Mahilo, but the current implementation is framed as app-specific infrastructure. The standalone repo should extract the reusable orchestration loop into something a developer can adopt quickly in another codebase.

## Product Positioning

This repo is a Symphony-inspired local orchestrator with stronger repo-native opinions:

- task tracking stays in markdown docs owned by the repo
- runtime progress is preserved in repo-owned files
- task selection is dependency-aware
- workflows are configured from a `WORKFLOW.md`-style file
- work happens in repo workspaces, preferably git worktrees
- decision logging is a first-class runtime artifact
- review cadence is explicit and configurable
- git integration cadence is explicit and configurable

The goal is not to outgrow Symphony. The goal is to offer a narrower, more copyable shape for repos that want file-backed orchestration rather than a tracker-centric setup.

## Target User And Primary Use Case

The primary user is a developer or small team maintaining a code repo who wants an autonomous coding loop without introducing a hosted task tracker, database, or orchestration service.

The expected usage pattern is:

1. copy the orchestrator into a repo
2. add or adapt a workflow file
3. write a markdown task list for a feature or milestone
4. let the orchestrator work through ready tasks one at a time
5. inspect durable artifacts, decisions, and git history as the loop progresses

The repo should work for TypeScript projects first, while remaining adaptable to other codebases through small workflow edits rather than framework-specific extensions.

## Value Add Over Base Symphony

Base Symphony already provides the general idea of an autonomous coding loop. This standalone repo should make the reasons to choose it explicit:

- it uses repo-local markdown task docs instead of assuming an external tracker such as Linear
- it keeps durable file-based artifacts such as progress logs, state, per-task last messages, and decision docs
- it derives task readiness from dependency metadata in repo docs
- it treats review passes as a configurable operating policy instead of an ad hoc manual step
- it treats commit and push cadence as configurable product behavior instead of an incidental implementation detail
- it is designed to be copied into an existing repo with a small amount of adaptation
- it keeps git-worktree-friendly execution as the default path for isolated task work

In short: Symphony is the inspiration, while this repo adds a more opinionated local-first operating model for teams that want the repo itself to be the control plane.

## Lean Scope For V1

The first standalone version should stay intentionally small.

It should include:

1. workflow parsing from front matter
2. markdown task parsing with `ID`, `Status`, `Priority`, and `Depends on`
3. dependency-aware task selection across one or more task docs
4. durable progress and state file writing
5. per-task last-message capture
6. decision doc support
7. workspace creation with git worktree as the default mode
8. agent prompt construction from workflow instructions and task sections
9. terminal task integration through explicit git commits
10. configurable push cadence
11. configurable review cadence
12. clear setup docs and small example files

The v1 bar is "useful and understandable in a real repo," not "feature-complete against every orchestration idea."

## Non-Goals

The standalone repo should explicitly avoid:

- becoming a broad orchestration platform with many providers and plugins
- supporting every tracker, storage backend, or workflow style
- requiring a server, dashboard, or database for normal operation
- introducing heavy remote infrastructure or managed services
- running multiple active implementation tasks within a single workflow by default
- turning crash recovery or supervision into a hosted control plane
- introducing bidirectional cross-project coordination or remote waiting queues

These can be added later only if they materially improve the copy-into-repo product without turning it into a platform.

## Core Product Concepts

### Workflow File

The workflow file defines:

- task source documents
- optional dependency source documents
- instruction files
- progress, state, and decision file locations
- workspace behavior
- agent command and args
- iteration and polling behavior
- completion phrase
- optional git guardrails

### Task Documents

Task docs are plain markdown sections with minimal metadata:

- `ID`
- `Status`
- `Priority`
- `Depends on`

This format should remain simple enough to edit by hand.

### Waiting Semantics

Waiting should stay explicit without introducing another task-doc status.

- `pending` is the only non-terminal queue state. A `pending` task may be ready now, waiting on unmet `Depends on`, or waiting for a scheduled retry.
- `blocked` is reserved for terminal or manual-intervention outcomes, not ordinary dependency waits.
- `dependency_sources` are read-only prerequisite docs. They can delay tasks in `task_sources`, but this workflow does not dispatch or mutate tasks from those docs.
- Runtime artifacts should explain why the loop is idle, including local dependency waits, external dependency waits, unresolved dependency IDs, and retry backoff windows.

### Runtime Artifacts

The standalone repo should preserve durable runtime artifacts as first-class behavior:

- progress log
- state file
- runtime status and heartbeat files
- per-task last-message capture
- decision doc log
- supervisor status file when supervised mode is enabled

These files are part of the product, not debugging leftovers. They are how a repo keeps operational memory between runs.

### Review Cadence

The standalone repo should support a built-in review pass after a configurable number of completed tasks.

Recommended default:

- `review_every_tasks: 3`

Expected behavior:

- after every N completed implementation tasks, start a review pass
- the reviewer inspects the last N completed tasks
- review findings create follow-up task(s) when acceptance criteria or behavior were missed
- review-created tasks use review-scoped IDs, append predictably into task docs, and depend only on the reviewed tasks they remediate
- the scheduler prefers review-created tasks over other same-priority ready work

### Git Integration Cadence

The standalone repo should keep git integration behavior explicit:

- completed terminal work is committed deliberately
- push behavior is configurable
- docs explain when changes stay local versus when they are integrated

This preserves one of the strongest Mahilo behaviors: the repo history shows how autonomous work was reconciled, not just that it happened.

### Workspaces

The default execution model should remain:

- one active task per workflow
- isolated task workspace
- git worktree by default
- shared workspace as an escape hatch

## Adoption Model

The adoption model should stay simple and biased toward copying:

1. Primary path: copy the orchestrator files into an existing repo, then edit the workflow and task docs.
2. Secondary path: fork the standalone repo and keep a lightly customized personal version.

The primary path matters most. A user should not need to buy into a framework, service, or large template just to try the orchestrator.

## Deferred Decisions

This scope document defines product boundaries, not every implementation choice.

The following are intentionally deferred to later tasks:

- final repo and folder layout
- exact CLI surface
- automatic cross-project wake-ups or upstream task dispatch for dependencies outside the current repo

## Crash Hardening Strategy

After the review loop and baseline adoption flow are in place, crash hardening should stay lean and local-first:

- workflow-scoped worker locks so duplicate loops for the same workflow fail fast
- dirty integration guards so cherry-picks do not run into a locally modified shared checkout
- orchestrator-owned tracker status updates so workers do not create avoidable task-doc conflicts
- non-fatal retries and backoff for agent, runtime, and integration failures
- stale-workspace refresh and conflict recovery so drifted task branches are rebuilt from the latest integration branch
- runtime heartbeat and status files for operator inspection
- a lightweight standalone supervisor that restarts stalled or dead workers
- optional macOS `launchd` support for long-running personal use

These features are worth carrying into the standalone repo because they improve correctness and operability without turning the orchestrator into a remote control plane.

Failure behavior should stay explicit: duplicate workers fail fast, agent/runtime/integration failures keep the task `pending` with durable retry state unless the worker explicitly reports `TASK_BLOCKED`, stale-workspace conflicts rebuild the task branch from the latest integration base before rerun, and the supervisor restarts only dead or stalled workers while exiting cleanly after terminal completion.

## Success Criteria

The standalone repo is successful when:

- it can be dropped into a fresh repo quickly
- the workflow is understandable from the docs alone
- it preserves the current Mahilo strengths that are still reusable
- it stays small enough to maintain without platform overhead
- it gives users a concrete reason to choose it over base Symphony
