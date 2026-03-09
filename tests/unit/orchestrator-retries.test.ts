import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runOrchestratorLoop } from "../../src/orchestrator";

const TEMP_REPOS: string[] = [];

function createTaskDoc(taskId = "TASK-001", title = "Retry Task") {
  return `### ${title}
- **ID**: \`${taskId}\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None
`;
}

function runGit(repoRoot: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function createRepo(params: {
  agentSource: string;
  taskDoc?: string;
  workspaceMode?: "shared" | "git_worktree";
  workflowExtras?: string[];
}) {
  const repoRoot = mkdtempSync(join(tmpdir(), "orchestrator-retries-"));
  TEMP_REPOS.push(repoRoot);

  mkdirSync(join(repoRoot, "docs"), { recursive: true });
  mkdirSync(join(repoRoot, ".orchestrator"), { recursive: true });
  writeFileSync(join(repoRoot, ".gitignore"), ".orchestrator/\n");
  writeFileSync(join(repoRoot, "fake-agent.cjs"), params.agentSource);
  writeFileSync(
    join(repoRoot, "docs/tasks.md"),
    params.taskDoc ?? createTaskDoc(),
  );
  writeFileSync(join(repoRoot, "docs/decisions.md"), "# Decisions\n");
  writeFileSync(join(repoRoot, "notes.txt"), "tracked note\n");
  writeFileSync(
    join(repoRoot, "WORKFLOW.md"),
    [
      "---",
      "name: retry-test",
      "task_sources:",
      "  - docs/tasks.md",
      "decision_file: docs/decisions.md",
      "progress_file: .orchestrator/progress.md",
      "state_file: .orchestrator/state.json",
      "workspace_root: .orchestrator/workspaces",
      `workspace_mode: ${params.workspaceMode ?? "shared"}`,
      `agent_command: "${process.execPath}"`,
      "agent_args:",
      "  - fake-agent.cjs",
      "max_iterations: 10",
      "poll_interval_seconds: 0",
      "completion_phrase: COMPLETE",
      "required_branch: main",
      "terminal_commit_behavior: per_task",
      "auto_push_every_commits: 0",
      "review_every_tasks: 0",
      "task_failure_retry_limit: 2",
      "task_failure_backoff_seconds: 0",
      ...(params.workflowExtras ?? []),
      "---",
      "# Workflow",
      "Exercise retry behavior.",
      "",
    ].join("\n"),
  );

  expect(runGit(repoRoot, ["init", "-b", "main"]).status).toBe(0);
  expect(
    runGit(repoRoot, ["config", "user.email", "orchestrator@example.com"])
      .status,
  ).toBe(0);
  expect(
    runGit(repoRoot, ["config", "user.name", "Orchestrator Test"]).status,
  ).toBe(0);
  expect(runGit(repoRoot, ["add", "-A"]).status).toBe(0);
  expect(runGit(repoRoot, ["commit", "-m", "initial"]).status).toBe(0);

  return repoRoot;
}

function runLoop(
  repoRoot: string,
  options: { maxIterations?: number; once?: boolean } = {},
) {
  const logs: string[] = [];
  const errors: string[] = [];
  const exitCode = runOrchestratorLoop(
    {
      workflowFile: "WORKFLOW.md",
      maxIterations: options.maxIterations ?? 10,
      once: options.once ?? false,
      dryRun: false,
    },
    {
      repoRoot,
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
      sleep: () => undefined,
    },
  );

  return { exitCode, logs, errors };
}

function createTaskWorktree(repoRoot: string, taskId = "TASK-001") {
  const workspacePath = join(
    repoRoot,
    ".orchestrator/workspaces",
    taskId.toLowerCase(),
  );
  const branchName = `orchestrator-${taskId.toLowerCase()}`;
  expect(
    runGit(repoRoot, [
      "worktree",
      "add",
      "-B",
      branchName,
      workspacePath,
      "main",
    ]).status,
  ).toBe(0);
  return { workspacePath, branchName };
}

function readState(repoRoot: string) {
  return JSON.parse(
    readFileSync(join(repoRoot, ".orchestrator/state.json"), "utf8"),
  ) as {
    taskFailures: Record<
      string,
      {
        consecutiveFailures: number;
        lastFailureAt: string;
        lastFailureKind: "agent" | "runtime" | "integration";
        lastFailureNote: string;
        lastBackoffSeconds: number;
        nextRetryAt: string | null;
        staleWorkspace: boolean;
        staleWorkspaceReason: string | null;
      }
    >;
    history: Array<{ status: string; note: string }>;
  };
}

afterEach(() => {
  while (TEMP_REPOS.length > 0) {
    const repoRoot = TEMP_REPOS.pop();
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

describe("orchestrator task retries", () => {
  it("retries a failed task run without killing the loop and clears retry state on success", () => {
    const repoRoot = createRepo({
      agentSource: `const fs = require("node:fs");
const path = require("node:path");

let workspace = process.cwd();
let outputPath = null;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "-C" && process.argv[index + 1]) {
    workspace = process.argv[index + 1];
    index += 1;
    continue;
  }
  if (arg === "-o" && process.argv[index + 1]) {
    outputPath = process.argv[index + 1];
    index += 1;
  }
}

const counterPath = path.join(workspace, ".agent-runs");
const runs =
  Number(fs.existsSync(counterPath) ? fs.readFileSync(counterPath, "utf8") : "0") + 1;
fs.writeFileSync(counterPath, String(runs));

if (runs >= 2 && outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    "TASK_DONE " + process.env.ORCHESTRATOR_TASK_ID + "\\nRecovered on retry.\\n",
  );
}

process.exit(runs === 1 ? 1 : 0);
`,
    });

    const result = runLoop(repoRoot, { maxIterations: 2 });
    const state = readState(repoRoot);

    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(readFileSync(join(repoRoot, ".agent-runs"), "utf8")).toBe("2");
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `done`",
    );
    expect(state.taskFailures).toEqual({});
    expect(state.history.map((entry) => entry.status)).toEqual([
      "retry_scheduled",
      "completed",
    ]);
    expect(
      readFileSync(join(repoRoot, ".orchestrator/progress.md"), "utf8"),
    ).toContain("retry_scheduled");
  });

  it("persists runtime failure backoff details and keeps the task pending", () => {
    const repoRoot = createRepo({
      agentSource: `process.exit(0);\n`,
      workspaceMode: "git_worktree",
      workflowExtras: [
        "workspace_root: .orchestrator/blocked-root/workspaces",
        "task_failure_retry_limit: 1",
        "task_failure_backoff_seconds: 5",
      ],
    });
    writeFileSync(join(repoRoot, ".orchestrator/blocked-root"), "not a dir\n");

    const result = runLoop(repoRoot, { once: true });
    const state = readState(repoRoot);
    const taskFailure = state.taskFailures["TASK-001"];

    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `pending`",
    );
    expect(taskFailure).toMatchObject({
      consecutiveFailures: 1,
      lastFailureKind: "runtime",
      lastBackoffSeconds: 5,
    });
    expect(taskFailure.nextRetryAt).not.toBeNull();
    expect(Date.parse(taskFailure.nextRetryAt ?? "")).toBeGreaterThan(
      Date.parse(taskFailure.lastFailureAt),
    );
    expect(state.history[0]?.status).toBe("retry_scheduled");
  });

  it("persists integration retry details when git-worktree integration fails", () => {
    const repoRoot = createRepo({
      agentSource: `const fs = require("node:fs");
const path = require("node:path");

let outputPath = null;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "-o" && process.argv[index + 1]) {
    outputPath = process.argv[index + 1];
    index += 1;
  }
}

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    "TASK_DONE " + process.env.ORCHESTRATOR_TASK_ID + "\\nFinished.\\n",
  );
}
`,
      workspaceMode: "git_worktree",
      workflowExtras: ["task_failure_backoff_seconds: 7"],
    });
    writeFileSync(join(repoRoot, "notes.txt"), "tracked note\ndirty change\n");
    writeFileSync(join(repoRoot, "scratch.txt"), "untracked change\n");

    const result = runLoop(repoRoot, { once: true });
    const state = readState(repoRoot);

    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `pending`",
    );
    expect(state.taskFailures["TASK-001"]).toMatchObject({
      consecutiveFailures: 1,
      lastFailureKind: "integration",
      lastBackoffSeconds: 7,
    });
    expect(state.history[0]?.status).toBe("retry_scheduled");
  });

  it("refreshes stale conflict workspaces from the latest integration branch before rerunning", () => {
    const repoRoot = createRepo({
      agentSource: `const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

let workspace = process.cwd();
let outputPath = null;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "-C" && process.argv[index + 1]) {
    workspace = process.argv[index + 1];
    index += 1;
    continue;
  }
  if (arg === "-o" && process.argv[index + 1]) {
    outputPath = process.argv[index + 1];
    index += 1;
  }
}

const counterPath = path.join(process.cwd(), ".orchestrator/agent-runs-total");
const runs =
  Number(fs.existsSync(counterPath) ? fs.readFileSync(counterPath, "utf8") : "0") + 1;
fs.mkdirSync(path.dirname(counterPath), { recursive: true });
fs.writeFileSync(counterPath, String(runs));

const workspaceHead = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: workspace,
  encoding: "utf8",
}).stdout.trim();
fs.writeFileSync(
  path.join(process.cwd(), ".orchestrator/workspace-head-" + runs),
  workspaceHead + "\\n",
);

if (runs >= 2) {
  fs.writeFileSync(path.join(workspace, "notes.txt"), "integration moved\\nrerun change\\n");
}

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    "TASK_DONE " + process.env.ORCHESTRATOR_TASK_ID + "\\nRecovered after workspace refresh.\\n",
  );
}
`,
      workspaceMode: "git_worktree",
    });
    const { workspacePath } = createTaskWorktree(repoRoot);

    writeFileSync(
      join(workspacePath, "notes.txt"),
      "stale task branch change\n",
    );
    expect(runGit(workspacePath, ["add", "notes.txt"]).status).toBe(0);
    expect(
      runGit(workspacePath, ["commit", "-m", "stale task seed"]).status,
    ).toBe(0);
    const staleWorkspaceHead = runGit(workspacePath, [
      "rev-parse",
      "HEAD",
    ]).stdout.trim();

    writeFileSync(join(repoRoot, "notes.txt"), "integration moved\n");
    expect(
      runGit(repoRoot, ["commit", "-am", "integration moved notes"]).status,
    ).toBe(0);
    const latestIntegrationHead = runGit(repoRoot, [
      "rev-parse",
      "HEAD",
    ]).stdout.trim();

    const result = runLoop(repoRoot, { maxIterations: 2 });
    const state = readState(repoRoot);

    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(
      readFileSync(join(repoRoot, ".orchestrator/agent-runs-total"), "utf8"),
    ).toBe("2");
    expect(state.taskFailures).toEqual({});
    expect(state.history.map((entry) => entry.status)).toEqual([
      "retry_scheduled",
      "completed",
    ]);
    expect(state.history[0]?.note).toContain("workspace is marked stale");
    expect(
      readFileSync(
        join(repoRoot, ".orchestrator/workspace-head-1"),
        "utf8",
      ).trim(),
    ).toBe(staleWorkspaceHead);
    expect(
      readFileSync(
        join(repoRoot, ".orchestrator/workspace-head-2"),
        "utf8",
      ).trim(),
    ).toBe(latestIntegrationHead);
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `done`",
    );
    expect(readFileSync(join(workspacePath, "notes.txt"), "utf8")).toBe(
      "integration moved\nrerun change\n",
    );
    expect(runGit(workspacePath, ["log", "--format=%s"]).stdout).not.toContain(
      "stale task seed",
    );
  });

  it("refreshes idle clean git worktrees when the integration branch moves forward", () => {
    const repoRoot = createRepo({
      agentSource: `const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

let workspace = process.cwd();
let outputPath = null;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "-C" && process.argv[index + 1]) {
    workspace = process.argv[index + 1];
    index += 1;
    continue;
  }
  if (arg === "-o" && process.argv[index + 1]) {
    outputPath = process.argv[index + 1];
    index += 1;
  }
}

const workspaceHead = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: workspace,
  encoding: "utf8",
}).stdout.trim();
const selectedHeadPath = path.join(
  process.cwd(),
  ".orchestrator/selected-workspace-head",
);
fs.mkdirSync(path.dirname(selectedHeadPath), { recursive: true });
fs.writeFileSync(selectedHeadPath, workspaceHead + "\\n");
fs.writeFileSync(path.join(workspace, "task.txt"), "fresh task change\\n");

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    "TASK_DONE " + process.env.ORCHESTRATOR_TASK_ID + "\\nUsed refreshed base.\\n",
  );
}
`,
      workspaceMode: "git_worktree",
    });
    const { workspacePath } = createTaskWorktree(repoRoot);
    const originalWorkspaceHead = runGit(workspacePath, [
      "rev-parse",
      "HEAD",
    ]).stdout.trim();

    writeFileSync(
      join(repoRoot, "notes.txt"),
      "tracked note\nintegration moved cleanly\n",
    );
    expect(
      runGit(repoRoot, ["commit", "-am", "integration advanced"]).status,
    ).toBe(0);
    const latestIntegrationHead = runGit(repoRoot, [
      "rev-parse",
      "HEAD",
    ]).stdout.trim();

    const result = runLoop(repoRoot, { once: true });

    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(
      readFileSync(
        join(repoRoot, ".orchestrator/selected-workspace-head"),
        "utf8",
      ).trim(),
    ).toBe(latestIntegrationHead);
    expect(
      readFileSync(
        join(repoRoot, ".orchestrator/selected-workspace-head"),
        "utf8",
      ).trim(),
    ).not.toBe(originalWorkspaceHead);
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `done`",
    );
    expect(readFileSync(join(workspacePath, "task.txt"), "utf8")).toBe(
      "fresh task change\n",
    );
  });

  it("stops auto-rerunning a task after the retry limit is exhausted", () => {
    const repoRoot = createRepo({
      agentSource: `const fs = require("node:fs");
const path = require("node:path");

let workspace = process.cwd();

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "-C" && process.argv[index + 1]) {
    workspace = process.argv[index + 1];
    index += 1;
  }
}

const counterPath = path.join(workspace, ".agent-runs");
const runs =
  Number(fs.existsSync(counterPath) ? fs.readFileSync(counterPath, "utf8") : "0") + 1;
fs.writeFileSync(counterPath, String(runs));
process.exit(1);
`,
      workflowExtras: ["task_failure_retry_limit: 1"],
    });

    const result = runLoop(repoRoot, { maxIterations: 3 });
    const state = readState(repoRoot);

    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(readFileSync(join(repoRoot, ".agent-runs"), "utf8")).toBe("2");
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `pending`",
    );
    expect(state.taskFailures["TASK-001"]).toMatchObject({
      consecutiveFailures: 2,
      lastFailureKind: "agent",
      nextRetryAt: null,
    });
    expect(state.history.map((entry) => entry.status)).toEqual([
      "retry_scheduled",
      "retry_exhausted",
    ]);
  });

  it("treats TASK_BLOCKED as terminal even when the agent exits nonzero", () => {
    const repoRoot = createRepo({
      agentSource: `const fs = require("node:fs");
const path = require("node:path");

let outputPath = null;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "-o" && process.argv[index + 1]) {
    outputPath = process.argv[index + 1];
    index += 1;
  }
}

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    "TASK_BLOCKED " + process.env.ORCHESTRATOR_TASK_ID + ": Waiting on an external dependency.\\n",
  );
}

process.exit(1);
`,
    });

    const result = runLoop(repoRoot, { once: true });
    const state = readState(repoRoot);

    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `blocked`",
    );
    expect(state.taskFailures).toEqual({});
    expect(state.history[0]?.status).toBe("blocked");
  });
});
