import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runOrchestratorLaunchdCli } from "../../src/orchestrator";

const SUPERVISOR_SCRIPT_PATH = join(
  process.cwd(),
  "scripts/orchestrator-supervisor.ts",
);
const LAUNCHD_SCRIPT_PATH = join(
  process.cwd(),
  "scripts/orchestrator-launchd.ts",
);
const RUNTIME_BINARY = process.execPath;
const TEMP_REPOS: string[] = [];

const SUPERVISED_DOGFOOD_AGENT = `const fs = require("node:fs");
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

const repoRoot = process.cwd();
const taskId = process.env.ORCHESTRATOR_TASK_ID || "";
const runsPath = path.join(
  repoRoot,
  ".orchestrator/runtime/agent-runs.json",
);
const decisionDocPath = path.join(workspace, "docs/decisions.md");

function loadRuns() {
  if (!fs.existsSync(runsPath)) {
    return { taskRuns: {} };
  }
  return JSON.parse(fs.readFileSync(runsPath, "utf8"));
}

function saveRuns(value) {
  fs.mkdirSync(path.dirname(runsPath), { recursive: true });
  fs.writeFileSync(runsPath, JSON.stringify(value, null, 2) + "\\n");
}

function incrementRun(id) {
  const runs = loadRuns();
  const current = Number(runs.taskRuns[id] || 0) + 1;
  runs.taskRuns[id] = current;
  saveRuns(runs);
  return current;
}

function ensureOutput(contents) {
  if (!outputPath) {
    process.exit(2);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, contents);
}

function ensureDecisionEntry(taskId, title, context, decision, impact) {
  const heading = "## 2026-03-10 - " + taskId + " - " + title;
  const entry =
    heading + "\\n" +
    "- Context: " + context + "\\n" +
    "- Decision: " + decision + "\\n" +
    "- Impact: " + impact + "\\n\\n";
  const existing = fs.existsSync(decisionDocPath)
    ? fs.readFileSync(decisionDocPath, "utf8")
    : "# Decisions\\n\\n";

  if (existing.includes(heading)) {
    return;
  }

  fs.writeFileSync(
    decisionDocPath,
    existing.replace(/\\s*$/, "\\n\\n") + entry,
  );
}

if (!taskId) {
  process.exit(3);
}

const run = incrementRun(taskId);

if (taskId === "DOG-SUP-001") {
  fs.writeFileSync(
    path.join(workspace, "supervised-baseline.txt"),
    "DOG-SUP-001 created the supervised baseline\\n",
  );
  ensureDecisionEntry(
    "DOG-SUP-001",
    "Exercise supervisor restarts on a live fixture",
    "The supervised dogfood fixture needs one tracked change and one durable decision entry before restart drills begin.",
    "Seed the baseline file from DOG-SUP-001 and record why the restart drill runs in a temp repo fixture.",
    "Later supervised steps can prove restart behavior without mutating the shared standalone task tracker or decision doc.",
  );
  ensureOutput(
    "TASK_DONE DOG-SUP-001\\nBootstrapped the supervised dogfood fixture.\\n",
  );
  process.exit(0);
}

if (taskId === "DOG-SUP-002") {
  if (run === 1) {
    setInterval(() => {}, 1000);
    return;
  }

  fs.writeFileSync(
    path.join(workspace, "supervised-restart.txt"),
    "DOG-SUP-002 recovered after the supervisor killed a stalled worker\\n",
  );
  ensureOutput(
    "TASK_DONE DOG-SUP-002\\nRecovered after the supervisor detected a runtime stall.\\n",
  );
  process.exit(0);
}

if (taskId === "DOG-SUP-003") {
  fs.writeFileSync(
    path.join(workspace, "supervised-summary.txt"),
    "DOG-SUP-003 confirmed the operator handoff after both restart paths\\n",
  );
  ensureOutput(
    "TASK_DONE DOG-SUP-003\\nCaptured the post-restart operator handoff.\\n",
  );
  process.exit(0);
}

process.exit(4);
`;

type SupervisorStatus = {
  state: string;
  restartCount: number;
  lastRestartReason: string | null;
  lastWorkerExitCode: number | null;
  worker: {
    pid: number | null;
    phase: string | null;
    activeTaskId: string | null;
    source: string;
  };
};

type RuntimeStatus = {
  pid: number;
  phase: string;
  activeTaskId: string | null;
  heartbeatAt: string;
  lastNote: string | null;
  lastError: string | null;
  lastHistoryStatus: string | null;
};

type AgentRuns = {
  taskRuns: Record<string, number>;
};

function runGit(repoRoot: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readSupervisorStatus(repoRoot: string): SupervisorStatus | null {
  const statusPath = join(
    repoRoot,
    ".orchestrator/runtime/supervisor-status.json",
  );
  if (!existsSync(statusPath)) {
    return null;
  }

  return readJson<SupervisorStatus>(statusPath);
}

function readRuntimeStatus(repoRoot: string): RuntimeStatus | null {
  const statusPath = join(repoRoot, ".orchestrator/runtime/status.json");
  if (!existsSync(statusPath)) {
    return null;
  }

  return readJson<RuntimeStatus>(statusPath);
}

function readHeartbeat(repoRoot: string): RuntimeStatus | null {
  const heartbeatPath = join(repoRoot, ".orchestrator/runtime/heartbeat.json");
  if (!existsSync(heartbeatPath)) {
    return null;
  }

  return readJson<RuntimeStatus>(heartbeatPath);
}

function readTaskStatuses(repoRoot: string) {
  const lines = readFileSync(join(repoRoot, "docs/tasks.md"), "utf8").split(
    /\r?\n/,
  );
  const statuses: Record<string, string> = {};
  let currentTaskId: string | null = null;

  for (const line of lines) {
    const idMatch = line.match(/^\s*-\s+\*\*ID\*\*:\s+`?([^`\n]+)`?/);
    if (idMatch) {
      currentTaskId = idMatch[1]?.trim() ?? null;
      continue;
    }

    const statusMatch = line.match(/^\s*-\s+\*\*Status\*\*:\s+`?([^`\n]+)`?/);
    if (currentTaskId && statusMatch) {
      statuses[currentTaskId] = statusMatch[1]?.trim() ?? "";
      currentTaskId = null;
    }
  }

  return statuses;
}

function createSupervisedDogfoodRepo() {
  const repoRoot = mkdtempSync(
    join(tmpdir(), "orchestrator-supervised-dogfood-"),
  );
  TEMP_REPOS.push(repoRoot);

  mkdirSync(join(repoRoot, "docs"), { recursive: true });
  writeFileSync(join(repoRoot, ".gitignore"), ".orchestrator/\n");
  writeFileSync(
    join(repoRoot, "docs/tasks.md"),
    `### Bootstrap supervised dogfood
- **ID**: \`DOG-SUP-001\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None

Create a tracked baseline change before the restart drills begin.

### Recover from a stalled worker
- **ID**: \`DOG-SUP-002\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: DOG-SUP-001

Hang once so the supervisor has to detect a stalled worker from runtime health.

### Confirm the operator handoff
- **ID**: \`DOG-SUP-003\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: DOG-SUP-002

Finish cleanly after both supervised restart paths have fired.
`,
  );
  writeFileSync(join(repoRoot, "docs/decisions.md"), "# Decisions\n");
  writeFileSync(join(repoRoot, "fake-agent.cjs"), SUPERVISED_DOGFOOD_AGENT);
  writeFileSync(
    join(repoRoot, "WORKFLOW.md"),
    [
      "---",
      "name: supervised-dogfood",
      "task_sources:",
      "  - docs/tasks.md",
      "decision_file: docs/decisions.md",
      "progress_file: .orchestrator/runtime/progress.md",
      "state_file: .orchestrator/runtime/state.json",
      "workspace_root: .orchestrator/runtime/workspaces",
      "workspace_mode: git_worktree",
      `agent_command: "${process.execPath}"`,
      "agent_args:",
      "  - fake-agent.cjs",
      "max_iterations: 10",
      "poll_interval_seconds: 3",
      "completion_phrase: COMPLETE",
      "required_branch: main",
      "terminal_commit_behavior: per_task",
      "auto_push_every_commits: 0",
      "review_every_tasks: 0",
      "task_failure_retry_limit: 1",
      "task_failure_backoff_seconds: 1",
      "---",
      "# Workflow",
      "Exercise the standalone supervisor against a live dogfood fixture.",
      "",
    ].join("\n"),
  );

  expect(runGit(repoRoot, ["init", "-b", "main"]).status).toBe(0);
  expect(
    runGit(repoRoot, ["config", "user.email", "orchestrator@example.com"])
      .status,
  ).toBe(0);
  expect(
    runGit(repoRoot, ["config", "user.name", "Supervised Dogfood Test"]).status,
  ).toBe(0);
  expect(runGit(repoRoot, ["add", "-A"]).status).toBe(0);
  expect(
    runGit(repoRoot, ["commit", "-m", "initial supervised dogfood fixture"])
      .status,
  ).toBe(0);

  return repoRoot;
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
  timeoutMs = 15000,
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

describe("standalone supervised dogfood", () => {
  it("restarts a dead worker, detects a stalled worker from runtime status, and completes the live fixture", async () => {
    const repoRoot = createSupervisedDogfoodRepo();
    const supervisor = spawn(
      RUNTIME_BINARY,
      [
        SUPERVISOR_SCRIPT_PATH,
        "run",
        "--workflow",
        "WORKFLOW.md",
        "--stall-seconds",
        "2",
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
    let supervisorExited = false;

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

      const sleepingStatus = await waitForCondition(
        () => {
          const runtime = readRuntimeStatus(repoRoot);
          return {
            runtime,
            taskStatuses: readTaskStatuses(repoRoot),
          };
        },
        ({ runtime, taskStatuses }) =>
          !!runtime &&
          runtime.phase === "sleeping" &&
          taskStatuses["DOG-SUP-001"] === "done" &&
          taskStatuses["DOG-SUP-002"] === "pending",
        20000,
      );

      expect(sleepingStatus.runtime?.lastHistoryStatus).toBe("completed");

      killProcessTree(firstWorkerPid, "SIGKILL");

      const deadWorkerRestart = await waitForCondition(
        () => readSupervisorStatus(repoRoot),
        (status) =>
          !!status &&
          status.restartCount >= 1 &&
          typeof status.worker.pid === "number" &&
          status.worker.pid > 0 &&
          status.worker.pid !== firstWorkerPid &&
          status.lastRestartReason?.includes("worker exit") === true,
      );
      const secondWorkerPid = deadWorkerRestart.worker.pid as number;

      const stalledRuntimeStatus = await waitForCondition(
        () => readRuntimeStatus(repoRoot),
        (status) =>
          !!status &&
          status.phase === "running_task" &&
          status.activeTaskId === "DOG-SUP-002",
        20000,
      );
      const stalledHeartbeat = readHeartbeat(repoRoot);

      expect(stalledRuntimeStatus.lastError).toBeNull();
      expect(stalledRuntimeStatus.lastHistoryStatus).toBe("completed");
      expect(stalledHeartbeat?.activeTaskId).toBe("DOG-SUP-002");
      expect(stalledHeartbeat?.phase).toBe("running_task");

      const stalledWorkerRestart = await waitForCondition(
        () => readSupervisorStatus(repoRoot),
        (status) =>
          !!status &&
          status.restartCount >= 2 &&
          typeof status.worker.pid === "number" &&
          status.worker.pid > 0 &&
          status.worker.pid !== secondWorkerPid &&
          status.lastRestartReason?.includes("runtime stall") === true,
        20000,
      );

      expect(stalledWorkerRestart.lastRestartReason).toContain("source=status");
      expect(stalledWorkerRestart.lastRestartReason).toContain(
        "phase=running_task",
      );
      expect(stalledWorkerRestart.lastRestartReason).toContain(
        "task=DOG-SUP-002",
      );

      const completedSupervisorStatus = await waitForCondition(
        () => readSupervisorStatus(repoRoot),
        (status) => !!status && status.state === "completed",
        20000,
      );

      const exitResult = await exitPromise;
      supervisorExited = true;

      expect(exitResult.code).toBe(0);
      expect(completedSupervisorStatus.restartCount).toBeGreaterThanOrEqual(2);
      expect(completedSupervisorStatus.lastWorkerExitCode).toBe(0);
      expect(completedSupervisorStatus.worker.phase).toBe("completed");
      expect(completedSupervisorStatus.worker.source).toBe("status");

      const taskStatuses = readTaskStatuses(repoRoot);
      expect(taskStatuses).toMatchObject({
        "DOG-SUP-001": "done",
        "DOG-SUP-002": "done",
        "DOG-SUP-003": "done",
      });

      const decisions = readFileSync(
        join(repoRoot, "docs/decisions.md"),
        "utf8",
      );
      expect(decisions).toContain(
        "## 2026-03-10 - DOG-SUP-001 - Exercise supervisor restarts on a live fixture",
      );

      const runtimeStatus = readRuntimeStatus(repoRoot);
      const heartbeat = readHeartbeat(repoRoot);
      expect(runtimeStatus).toMatchObject({
        phase: "completed",
        activeTaskId: null,
        lastHistoryStatus: "completed",
      });
      expect(runtimeStatus?.lastNote).toContain(
        "All tracked tasks are complete.",
      );
      expect(heartbeat).toMatchObject({
        phase: "completed",
        activeTaskId: null,
      });

      for (const fileName of [
        "progress.md",
        "state.json",
        "status.json",
        "heartbeat.json",
        "supervisor-status.json",
        "dog-sup-001-last-message.txt",
        "dog-sup-002-last-message.txt",
        "dog-sup-003-last-message.txt",
      ]) {
        expect(
          existsSync(join(repoRoot, ".orchestrator/runtime", fileName)),
        ).toBe(true);
      }

      const agentRuns = readJson<AgentRuns>(
        join(repoRoot, ".orchestrator/runtime/agent-runs.json"),
      );
      expect(agentRuns.taskRuns).toMatchObject({
        "DOG-SUP-001": 1,
        "DOG-SUP-002": 2,
        "DOG-SUP-003": 1,
      });

      const gitLog = runGit(repoRoot, ["log", "--format=%s"]).stdout;
      expect(gitLog).toContain(
        "orchestrator: complete DOG-SUP-001 Bootstrap supervised dogfood",
      );
      expect(gitLog).toContain(
        "orchestrator: complete DOG-SUP-002 Recover from a stalled worker",
      );
      expect(gitLog).toContain(
        "orchestrator: complete DOG-SUP-003 Confirm the operator handoff",
      );

      const launchdLogs: string[] = [];
      const launchdErrors: string[] = [];
      const launchdExitCode = runOrchestratorLaunchdCli(
        ["print", "--workflow", "WORKFLOW.md"],
        {
          repoRoot,
          env: {
            PATH: "/usr/bin:/bin",
            HOME: repoRoot,
          },
          scriptPath: LAUNCHD_SCRIPT_PATH,
          log: (message) => launchdLogs.push(message),
          error: (message) => launchdErrors.push(message),
        },
      );

      expect(launchdExitCode).toBe(0);
      expect(launchdErrors).toEqual([]);
      expect(launchdLogs.join("\n")).toContain(join(repoRoot, "WORKFLOW.md"));
      expect(launchdLogs.join("\n")).toContain(
        join(process.cwd(), "scripts/orchestrator-supervisor.ts"),
      );
      expect(launchdLogs.join("\n")).toContain(
        join(repoRoot, ".orchestrator/runtime/launchd.out.log"),
      );
    } finally {
      if (
        !supervisorExited &&
        supervisor.pid &&
        isProcessAlive(supervisor.pid)
      ) {
        supervisor.kill("SIGTERM");
        await exitPromise;
      }
    }
  }, 30000);
});
