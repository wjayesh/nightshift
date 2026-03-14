import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const CLI_SCRIPT_PATH = join(process.cwd(), "scripts/orchestrator.ts");
const RUNTIME_BINARY = process.execPath;
const TEMP_REPOS: string[] = [];

const FAKE_AGENT = `const fs = require("node:fs");
const path = require("node:path");

let workspace = process.cwd();

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "-C" && process.argv[index + 1]) {
    workspace = process.argv[index + 1];
    index += 1;
    continue;
  }
  if (arg === "-o" && process.argv[index + 1]) {
    index += 1;
  }
}

const counterPath = path.join(workspace, ".agent-runs");
const runs =
  Number(fs.existsSync(counterPath) ? fs.readFileSync(counterPath, "utf8") : "0") + 1;
fs.writeFileSync(counterPath, String(runs));
`;

function createTaskDoc(taskId: string, title: string): string {
  return `### ${title}
- **ID**: \`${taskId}\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None
`;
}

function createWorkflow(taskSource: string): string {
  return createWorkflowWithDependencies(taskSource);
}

function createWorkflowWithDependencies(
  taskSource: string,
  dependencySources: string[] = [],
  options: {
    progressFile?: string;
    stateFile?: string;
    workspaceRoot?: string;
    pollIntervalSeconds?: number;
    maxIterations?: number;
    workspaceMode?: "shared" | "git_worktree";
    requiredBranch?: string | null;
  } = {},
): string {
  const progressFile = options.progressFile ?? ".orchestrator/progress.md";
  const stateFile = options.stateFile ?? ".orchestrator/state.json";
  const workspaceRoot = options.workspaceRoot ?? ".orchestrator/workspaces";
  const pollIntervalSeconds = options.pollIntervalSeconds ?? 0;
  const maxIterations = options.maxIterations ?? 10;
  const workspaceMode = options.workspaceMode ?? "shared";

  return [
    "---",
    "name: cli-test",
    "task_sources:",
    `  - ${taskSource}`,
    ...(dependencySources.length > 0
      ? [
          "dependency_sources:",
          ...dependencySources.map((dependency) => `  - ${dependency}`),
        ]
      : []),
    `progress_file: ${progressFile}`,
    `state_file: ${stateFile}`,
    `workspace_root: ${workspaceRoot}`,
    `workspace_mode: ${workspaceMode}`,
    `agent_command: "${RUNTIME_BINARY}"`,
    "agent_args:",
    "  - fake-agent.cjs",
    `max_iterations: ${maxIterations}`,
    `poll_interval_seconds: ${pollIntervalSeconds}`,
    "completion_phrase: COMPLETE",
    ...(options.requiredBranch
      ? [`required_branch: ${options.requiredBranch}`]
      : []),
    "terminal_commit_behavior: per_task",
    "auto_push_every_commits: 0",
    "---",
    "# Workflow",
    "Exercise the standalone CLI entrypoint.",
    "",
  ].join("\n");
}

function createTempRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "orchestrator-cli-"));
  TEMP_REPOS.push(repoRoot);

  mkdirSync(join(repoRoot, "docs"), { recursive: true });
  writeFileSync(join(repoRoot, "fake-agent.cjs"), FAKE_AGENT);
  writeFileSync(
    join(repoRoot, "docs/tasks.md"),
    createTaskDoc("TASK-001", "Default Task"),
  );
  writeFileSync(
    join(repoRoot, "docs/alt-tasks.md"),
    createTaskDoc("TASK-ALT", "Alternate Task"),
  );
  writeFileSync(join(repoRoot, "WORKFLOW.md"), createWorkflow("docs/tasks.md"));
  writeFileSync(
    join(repoRoot, "WORKFLOW.alt.md"),
    createWorkflow("docs/alt-tasks.md"),
  );

  return repoRoot;
}

function runCli(repoRoot: string, args: string[]) {
  return spawnSync(RUNTIME_BINARY, [CLI_SCRIPT_PATH, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function runGit(repoRoot: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

async function waitForPath(path: string, timeoutMs = 5000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(path)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${path}`);
}

function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
}

afterEach(() => {
  while (TEMP_REPOS.length > 0) {
    const repoRoot = TEMP_REPOS.pop();
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

describe("standalone orchestrator CLI", () => {
  it("supports continuous mode across multiple iterations", () => {
    const repoRoot = createTempRepo();
    const result = runCli(repoRoot, ["--max-iterations", "2"]);

    expect(result.status).toBe(0);
    expect(readFileSync(join(repoRoot, ".agent-runs"), "utf8")).toBe("2");
    expect(result.stdout).toContain(
      "Reached max iterations without seeing COMPLETE.",
    );
  });

  it("supports --once", () => {
    const repoRoot = createTempRepo();
    const result = runCli(repoRoot, ["--once"]);

    expect(result.status).toBe(0);
    expect(readFileSync(join(repoRoot, ".agent-runs"), "utf8")).toBe("1");
    expect(result.stdout).toContain(
      "=== Iteration 1: TASK-001 Default Task ===",
    );
    expect(result.stdout).not.toContain("Reached max iterations");
  });

  it("supports --dry-run without invoking the agent", () => {
    const repoRoot = createTempRepo();
    const result = runCli(repoRoot, ["--once", "--dry-run"]);

    expect(result.status).toBe(0);
    expect(existsSync(join(repoRoot, ".agent-runs"))).toBe(false);
    expect(result.stdout).toContain("Dry run selected task summary:");
    expect(result.stdout).toContain("- Task: TASK-001");
  });

  it("leaves state and progress artifacts unchanged during --dry-run", () => {
    const repoRoot = createTempRepo();
    mkdirSync(join(repoRoot, ".orchestrator"), { recursive: true });

    const statePath = join(repoRoot, ".orchestrator/state.json");
    const progressPath = join(repoRoot, ".orchestrator/progress.md");
    const originalState =
      JSON.stringify(
        {
          workflowPath: "WORKFLOW.md",
          iteration: 7,
          activeTaskId: null,
          commitsSincePush: 0,
          lastCommittedTaskId: null,
          lastCommitSha: null,
          reviews: [],
          lastReviewedCompletionCount: 0,
          taskFailures: {},
          history: [],
        },
        null,
        2,
      ) + "\n";
    const originalProgress = "# cli-test Progress\n\n- preserved entry\n";

    writeFileSync(statePath, originalState);
    writeFileSync(progressPath, originalProgress);

    const result = runCli(repoRoot, ["--once", "--dry-run"]);

    expect(result.status).toBe(0);
    expect(readFileSync(statePath, "utf8")).toBe(originalState);
    expect(readFileSync(progressPath, "utf8")).toBe(originalProgress);
  });

  it("supports workflow file selection", () => {
    const repoRoot = createTempRepo();
    const result = runCli(repoRoot, [
      "--once",
      "--dry-run",
      "--workflow",
      "WORKFLOW.alt.md",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("- Task: TASK-ALT");
    expect(result.stdout).not.toContain("- Task: TASK-001");
  });

  it("keeps a workflow-scoped worker lock for the loop lifetime and fails fast on duplicate starts", async () => {
    const repoRoot = createTempRepo();

    writeFileSync(
      join(repoRoot, "docs/stalled-tasks.md"),
      `### Waiting Task
- **ID**: \`TASK-WAIT\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: MISSING-001
`,
    );
    writeFileSync(
      join(repoRoot, "WORKFLOW.runtime-lock.md"),
      createWorkflowWithDependencies("docs/stalled-tasks.md", [], {
        progressFile: ".orchestrator/runtime/progress.md",
        stateFile: ".orchestrator/runtime/state.json",
        pollIntervalSeconds: 5,
        maxIterations: 5,
      }),
    );

    const lockPath = join(
      repoRoot,
      ".orchestrator/runtime/worker-workflow.runtime-lock.md.lock",
    );
    const child = spawn(
      RUNTIME_BINARY,
      [CLI_SCRIPT_PATH, "--workflow", "WORKFLOW.runtime-lock.md"],
      {
        cwd: repoRoot,
        stdio: "pipe",
      },
    );
    const exitPromise = waitForExit(child);

    try {
      await waitForPath(lockPath);
      expect(existsSync(lockPath)).toBe(true);

      const startedAt = Date.now();
      const result = runCli(repoRoot, [
        "--once",
        "--workflow",
        "WORKFLOW.runtime-lock.md",
      ]);
      const elapsedMs = Date.now() - startedAt;

      expect(result.status).toBe(1);
      expect(elapsedMs).toBeLessThan(3000);
      expect(result.stderr).toContain("already has an active worker");
      expect(result.stderr).toContain("WORKFLOW.runtime-lock.md");
      expect(result.stderr).toContain(
        "Worker lock: .orchestrator/runtime/worker-workflow.runtime-lock.md.lock",
      );
    } finally {
      child.kill("SIGTERM");
      await exitPromise;
    }
  });

  it("removes stale worker locks before starting the workflow again", () => {
    const repoRoot = createTempRepo();

    writeFileSync(
      join(repoRoot, "docs/runtime-tasks.md"),
      createTaskDoc("TASK-RUNTIME", "Runtime Task"),
    );
    writeFileSync(
      join(repoRoot, "WORKFLOW.runtime-lock.md"),
      createWorkflowWithDependencies("docs/runtime-tasks.md", [], {
        progressFile: ".orchestrator/runtime/progress.md",
        stateFile: ".orchestrator/runtime/state.json",
      }),
    );

    const lockPath = join(
      repoRoot,
      ".orchestrator/runtime/worker-workflow.runtime-lock.md.lock",
    );
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      join(lockPath, "owner.json"),
      JSON.stringify(
        {
          pid: 999999,
          workflow: "cli-test",
          workflowPath: "WORKFLOW.runtime-lock.md",
          purpose: "worker",
          detail: "loop",
          acquiredAt: "2026-03-10T00:00:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );

    const result = runCli(repoRoot, [
      "--once",
      "--dry-run",
      "--workflow",
      "WORKFLOW.runtime-lock.md",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("- Task: TASK-RUNTIME");
    expect(result.stderr).toBe("");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("uses workflow dependency_sources during task selection", () => {
    const repoRoot = createTempRepo();

    writeFileSync(
      join(repoRoot, "docs/gated-tasks.md"),
      `### Gated Task
- **ID**: \`APP-001\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: CORE-001
`,
    );
    writeFileSync(
      join(repoRoot, "docs/dependencies.md"),
      `### Core Task
- **ID**: \`CORE-001\`
- **Status**: \`done\`
- **Priority**: P0
- **Depends on**: None
`,
    );
    writeFileSync(
      join(repoRoot, "WORKFLOW.deps.md"),
      createWorkflowWithDependencies("docs/gated-tasks.md", [
        "docs/dependencies.md",
      ]),
    );

    const result = runCli(repoRoot, [
      "--once",
      "--dry-run",
      "--workflow",
      "WORKFLOW.deps.md",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("- Task: APP-001");
    expect(result.stdout).toContain("- Depends on: CORE-001");
  });

  it("skips final push when auto-push is disabled", () => {
    const repoRoot = createTempRepo();
    mkdirSync(join(repoRoot, ".orchestrator"), { recursive: true });
    writeFileSync(
      join(repoRoot, "docs/tasks.md"),
      `### Completed Task
- **ID**: \`TASK-001\`
- **Status**: \`done\`
- **Priority**: P0
- **Depends on**: None
`,
    );
    writeFileSync(
      join(repoRoot, ".orchestrator/state.json"),
      JSON.stringify(
        {
          workflowPath: "WORKFLOW.md",
          iteration: 3,
          activeTaskId: null,
          commitsSincePush: 2,
          lastCommittedTaskId: "TASK-001",
          lastCommitSha: "abc1234",
          history: [],
        },
        null,
        2,
      ) + "\n",
    );

    expect(runGit(repoRoot, ["init", "-b", "main"]).status).toBe(0);

    const result = runCli(repoRoot, ["--once"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("COMPLETE");
    expect(result.stderr).toBe("");
  });

  it("uses the current checkout branch when required_branch is omitted", () => {
    const repoRoot = createTempRepo();

    writeFileSync(
      join(repoRoot, "fake-agent.cjs"),
      `const fs = require("node:fs");
const path = require("node:path");
let outputPath = null;
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o" && process.argv[index + 1]) {
    outputPath = process.argv[index + 1];
    index += 1;
  }
}
if (!outputPath) process.exit(2);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, "TASK_DONE TASK-001\\n");
`,
    );
    writeFileSync(
      join(repoRoot, "WORKFLOW.branchless.md"),
      createWorkflowWithDependencies("docs/tasks.md", [], {
        workspaceMode: "git_worktree",
      }),
    );

    expect(runGit(repoRoot, ["init", "-b", "feature/self-fix"]).status).toBe(0);
    expect(
      runGit(repoRoot, ["config", "user.email", "cli-test@example.com"]).status,
    ).toBe(0);
    expect(runGit(repoRoot, ["config", "user.name", "CLI Test"]).status).toBe(
      0,
    );
    expect(runGit(repoRoot, ["add", "-A"]).status).toBe(0);
    expect(runGit(repoRoot, ["commit", "-m", "initial"]).status).toBe(0);

    const result = runCli(repoRoot, [
      "--once",
      "--workflow",
      "WORKFLOW.branchless.md",
    ]);

    expect(result.status).toBe(0);
    expect(runGit(repoRoot, ["branch", "--show-current"]).stdout.trim()).toBe(
      "feature/self-fix",
    );
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `done`",
    );
  });
});
