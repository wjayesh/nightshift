import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SUPERVISOR_SCRIPT_PATH = join(
  process.cwd(),
  "scripts/orchestrator-supervisor.ts",
);
const RUNTIME_BINARY = process.execPath;
const TEMP_REPOS: string[] = [];

const NOOP_AGENT = `process.exit(0);\n`;
const HANGING_AGENT = `setInterval(() => {}, 1000);\n`;
const COMPLETE_AGENT = `const { writeFileSync } = require("node:fs");
const outputIndex = process.argv.indexOf("-o");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (!outputPath) {
  process.exit(1);
}
writeFileSync(
  outputPath,
  \`TASK_DONE \${process.env.ORCHESTRATOR_TASK_ID ?? "TASK-001"}\\n\`,
);
process.exit(0);
`;

type SupervisorStatus = {
  pid: number;
  state: string;
  restartCount: number;
  lastRestartReason: string | null;
  lastWorkerExitCode: number | null;
  worker: {
    pid: number | null;
    phase: string | null;
    source: string;
  };
};

function createTaskDoc(
  taskId: string,
  title: string,
  dependsOn = "None",
): string {
  return `### ${title}
- **ID**: \`${taskId}\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: ${dependsOn}
`;
}

function createWorkflow(
  taskSource: string,
  agentScript: string,
  options: {
    pollIntervalSeconds?: number;
    maxIterations?: number;
  } = {},
): string {
  const pollIntervalSeconds = options.pollIntervalSeconds ?? 30;
  const maxIterations = options.maxIterations ?? 100;

  return [
    "---",
    "name: supervisor-test",
    "task_sources:",
    `  - ${taskSource}`,
    "progress_file: .orchestrator/runtime/progress.md",
    "state_file: .orchestrator/runtime/state.json",
    "workspace_root: .orchestrator/runtime/workspaces",
    "workspace_mode: shared",
    `agent_command: "${RUNTIME_BINARY}"`,
    "agent_args:",
    `  - ${agentScript}`,
    `max_iterations: ${maxIterations}`,
    `poll_interval_seconds: ${pollIntervalSeconds}`,
    "completion_phrase: COMPLETE",
    "terminal_commit_behavior: per_task",
    "auto_push_every_commits: 0",
    "review_every_tasks: 0",
    "---",
    "# Workflow",
    "Exercise the standalone supervisor.",
    "",
  ].join("\n");
}

function createTempRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "orchestrator-supervisor-"));
  TEMP_REPOS.push(repoRoot);

  mkdirSync(join(repoRoot, "docs"), { recursive: true });
  writeFileSync(join(repoRoot, "noop-agent.cjs"), NOOP_AGENT);
  writeFileSync(join(repoRoot, "hanging-agent.cjs"), HANGING_AGENT);
  writeFileSync(join(repoRoot, "complete-agent.cjs"), COMPLETE_AGENT);

  return repoRoot;
}

function initializeGitRepo(repoRoot: string) {
  spawnSync("git", ["init"], { cwd: repoRoot, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Supervisor Test"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  spawnSync("git", ["config", "user.email", "supervisor@test.invalid"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  spawnSync("git", ["add", "."], { cwd: repoRoot, encoding: "utf8" });
  spawnSync("git", ["commit", "-m", "init"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function runSupervisorCli(repoRoot: string, args: string[]) {
  return spawnSync(RUNTIME_BINARY, [SUPERVISOR_SCRIPT_PATH, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function readSupervisorStatus(repoRoot: string): SupervisorStatus | null {
  const statusPath = join(
    repoRoot,
    ".orchestrator/runtime/supervisor-status.json",
  );
  if (!existsSync(statusPath)) {
    return null;
  }

  return JSON.parse(readFileSync(statusPath, "utf8")) as SupervisorStatus;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    process.kill(pid, signal);
  }
}

async function waitForCondition<T>(
  readValue: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 10000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = readValue();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for condition.");
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

describe("standalone supervisor", () => {
  it("restarts the worker when the supervised orchestrator process dies", async () => {
    const repoRoot = createTempRepo();
    writeFileSync(
      join(repoRoot, "docs/waiting-tasks.md"),
      createTaskDoc("TASK-WAIT", "Waiting Task", "MISSING-001"),
    );
    writeFileSync(
      join(repoRoot, "WORKFLOW.supervisor.md"),
      createWorkflow("docs/waiting-tasks.md", "noop-agent.cjs"),
    );

    const supervisor = spawn(
      RUNTIME_BINARY,
      [
        SUPERVISOR_SCRIPT_PATH,
        "run",
        "--workflow",
        "WORKFLOW.supervisor.md",
        "--stall-seconds",
        "30",
        "--check-interval-seconds",
        "1",
        "--restart-delay-seconds",
        "0",
      ],
      {
        cwd: repoRoot,
        stdio: "pipe",
      },
    );
    const exitPromise = waitForExit(supervisor);

    try {
      const startedStatus = await waitForCondition(
        () => readSupervisorStatus(repoRoot),
        (status) =>
          !!status &&
          status.state === "running" &&
          typeof status.worker.pid === "number" &&
          status.worker.pid > 0,
      );
      const firstWorkerPid = startedStatus.worker.pid as number;

      killProcessTree(firstWorkerPid, "SIGKILL");

      const restartedStatus = await waitForCondition(
        () => readSupervisorStatus(repoRoot),
        (status) =>
          !!status &&
          status.restartCount >= 1 &&
          typeof status.worker.pid === "number" &&
          status.worker.pid > 0 &&
          status.worker.pid !== firstWorkerPid,
      );

      expect(restartedStatus.lastRestartReason).toContain("worker exit");
    } finally {
      supervisor.kill("SIGTERM");
      await exitPromise;
    }
  });

  it("restarts the worker when runtime status stops advancing", async () => {
    const repoRoot = createTempRepo();
    writeFileSync(
      join(repoRoot, "docs/hanging-task.md"),
      createTaskDoc("TASK-HANG", "Hanging Task"),
    );
    writeFileSync(
      join(repoRoot, "WORKFLOW.hanging.md"),
      createWorkflow("docs/hanging-task.md", "hanging-agent.cjs", {
        pollIntervalSeconds: 0,
      }),
    );

    const supervisor = spawn(
      RUNTIME_BINARY,
      [
        SUPERVISOR_SCRIPT_PATH,
        "run",
        "--workflow",
        "WORKFLOW.hanging.md",
        "--stall-seconds",
        "1",
        "--check-interval-seconds",
        "1",
        "--restart-delay-seconds",
        "0",
      ],
      {
        cwd: repoRoot,
        stdio: "pipe",
      },
    );
    const exitPromise = waitForExit(supervisor);

    try {
      const stalledStatus = await waitForCondition(
        () => readSupervisorStatus(repoRoot),
        (status) => !!status && status.restartCount >= 1,
        15000,
      );

      expect(stalledStatus.lastRestartReason).toContain("runtime stall");
      expect(stalledStatus.lastRestartReason).toContain("phase=running_task");
      expect(stalledStatus.lastRestartReason).toContain("source=status");
    } finally {
      supervisor.kill("SIGTERM");
      await exitPromise;
    }
  });

  it("treats terminal completion as final without restart backoff", async () => {
    const repoRoot = createTempRepo();
    writeFileSync(
      join(repoRoot, "docs/completing-task.md"),
      createTaskDoc("TASK-DONE", "Completing Task"),
    );
    writeFileSync(
      join(repoRoot, "WORKFLOW.completed.md"),
      createWorkflow("docs/completing-task.md", "complete-agent.cjs", {
        pollIntervalSeconds: 0,
      }),
    );
    initializeGitRepo(repoRoot);

    const supervisor = spawn(
      RUNTIME_BINARY,
      [
        SUPERVISOR_SCRIPT_PATH,
        "run",
        "--workflow",
        "WORKFLOW.completed.md",
        "--stall-seconds",
        "30",
        "--check-interval-seconds",
        "1",
        "--restart-delay-seconds",
        "0",
      ],
      {
        cwd: repoRoot,
        stdio: "pipe",
      },
    );

    const exitResult = await waitForExit(supervisor);
    expect(exitResult.code).toBe(0);

    const status = await waitForCondition(
      () => readSupervisorStatus(repoRoot),
      (currentStatus) => !!currentStatus && currentStatus.state === "completed",
    );

    expect(status.restartCount).toBe(0);
    expect(status.lastRestartReason).toBeNull();
    expect(status.lastWorkerExitCode).toBe(0);
    expect(status.worker.phase).toBe("completed");
  });

  it("supports background start, status, and stop commands", async () => {
    const repoRoot = createTempRepo();
    writeFileSync(
      join(repoRoot, "docs/waiting-tasks.md"),
      createTaskDoc("TASK-WAIT", "Waiting Task", "MISSING-001"),
    );
    writeFileSync(
      join(repoRoot, "WORKFLOW.supervisor.md"),
      createWorkflow("docs/waiting-tasks.md", "noop-agent.cjs"),
    );

    const startResult = runSupervisorCli(repoRoot, [
      "start",
      "--workflow",
      "WORKFLOW.supervisor.md",
      "--stall-seconds",
      "30",
      "--check-interval-seconds",
      "1",
      "--restart-delay-seconds",
      "0",
    ]);

    expect(startResult.status).toBe(0);

    try {
      const startedStatus = await waitForCondition(
        () => readSupervisorStatus(repoRoot),
        (status) =>
          !!status &&
          status.state === "running" &&
          typeof status.pid === "number" &&
          status.pid > 0 &&
          typeof status.worker.pid === "number" &&
          status.worker.pid > 0,
      );

      const statusResult = runSupervisorCli(repoRoot, [
        "status",
        "--workflow",
        "WORKFLOW.supervisor.md",
      ]);

      expect(statusResult.status).toBe(0);
      expect(statusResult.stdout).toContain("Supervisor: running");
      expect(statusResult.stdout).toContain("Supervisor state: running");
      expect(statusResult.stdout).toContain("Worker phase:");
      expect(statusResult.stdout).toContain(
        "Supervisor status file: .orchestrator/runtime/supervisor-status.json",
      );

      const stopResult = runSupervisorCli(repoRoot, [
        "stop",
        "--workflow",
        "WORKFLOW.supervisor.md",
      ]);

      expect(stopResult.status).toBe(0);
      expect(stopResult.stdout).toContain("Stopped supervisor");

      await waitForCondition(
        () => readSupervisorStatus(repoRoot),
        (status) => !!status && status.state === "stopped",
      );
      expect(isProcessAlive(startedStatus.pid)).toBe(false);
    } finally {
      runSupervisorCli(repoRoot, [
        "stop",
        "--workflow",
        "WORKFLOW.supervisor.md",
      ]);
    }
  });
});
