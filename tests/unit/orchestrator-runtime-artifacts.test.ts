import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendProgress,
  loadState,
  parseTaskFile,
  parseWorkflowFile,
  runAgentForTask,
  runOrchestratorLoop,
  saveState,
} from "../../src/orchestrator";

const TEMP_DIRS: string[] = [];

function createTempRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "orchestrator-runtime-"));
  TEMP_DIRS.push(repoRoot);
  return repoRoot;
}

function runGit(repoRoot: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const repoRoot = TEMP_DIRS.pop();
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

describe("runtime artifacts", () => {
  it("creates and persists the configured state and progress files", () => {
    const repoRoot = createTempRepo();
    const workflow = parseWorkflowFile(`---
name: runtime-artifacts
progress_file: .orchestrator/runtime/progress.md
state_file: .orchestrator/runtime/state.json
---
# Workflow
Runtime artifacts stay inside the repo.
`);

    const state = loadState(repoRoot, workflow);
    const statePath = join(repoRoot, ".orchestrator/runtime/state.json");
    const progressPath = join(repoRoot, ".orchestrator/runtime/progress.md");

    expect(existsSync(statePath)).toBe(true);
    expect(state).toMatchObject({
      workflowPath: "WORKFLOW.md",
      iteration: 0,
      activeTaskId: null,
      commitsSincePush: 0,
      lastCommittedTaskId: null,
      lastCommitSha: null,
      taskFailures: {},
      history: [],
    });

    state.iteration = 2;
    state.activeTaskId = "ORCH-012";
    state.history.push({
      iteration: 2,
      taskId: "ORCH-012",
      timestamp: "2026-03-10T00:00:00.000Z",
      status: "started",
      note: "Picked ORCH-012.",
    });
    state.taskFailures["ORCH-012"] = {
      consecutiveFailures: 1,
      lastFailureAt: "2026-03-10T00:00:30.000Z",
      lastFailureKind: "agent",
      lastFailureNote: "Agent exited 1.",
      lastBackoffSeconds: 30,
      nextRetryAt: "2026-03-10T00:01:00.000Z",
      staleWorkspace: false,
      staleWorkspaceReason: null,
    };
    saveState(repoRoot, workflow, state);

    const reloadedState = loadState(repoRoot, workflow);
    expect(reloadedState).toMatchObject({
      iteration: 2,
      activeTaskId: "ORCH-012",
    });
    expect(reloadedState.history).toHaveLength(1);
    expect(reloadedState.taskFailures["ORCH-012"]).toMatchObject({
      consecutiveFailures: 1,
      lastFailureKind: "agent",
      lastBackoffSeconds: 30,
      nextRetryAt: "2026-03-10T00:01:00.000Z",
      staleWorkspace: false,
      staleWorkspaceReason: null,
    });

    appendProgress(repoRoot, workflow, [
      "- 2026-03-10T00:00:00.000Z | ORCH-012 | started | Picked ORCH-012.",
    ]);

    const progress = readFileSync(progressPath, "utf8");
    expect(progress).toContain("# runtime-artifacts Progress");
    expect(progress).toContain("ORCH-012 | started");
  });

  it("captures each task's last message under the runtime root", () => {
    const repoRoot = createTempRepo();
    const workflow = parseWorkflowFile(`---
name: runtime-artifacts
state_file: .orchestrator/runtime/state.json
---
# Workflow
Capture terminal agent output.
`);
    workflow.agentCommand = process.execPath;
    workflow.agentArgs = [join(repoRoot, "fake-agent.cjs")];

    writeFileSync(
      join(repoRoot, "fake-agent.cjs"),
      `const fs = require("node:fs");
const path = require("node:path");

let outputPath = null;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "-o" && process.argv[index + 1]) {
    outputPath = process.argv[index + 1];
    index += 1;
  }
}

if (!outputPath) {
  process.exit(2);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  \`TASK_DONE \${process.env.ORCHESTRATOR_TASK_ID}\\nCaptured terminal summary.\\n\`,
);
`,
    );

    const [task] = parseTaskFile(
      `### Preserve Runtime Artifacts
- **ID**: \`ORCH-012/runtime test\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None
`,
      "docs/tasks.md",
    );

    const result = runAgentForTask(
      repoRoot,
      workflow,
      task,
      join(repoRoot, "workspace"),
      "Implement ORCH-012.",
    );
    const lastMessagePath = join(
      repoRoot,
      ".orchestrator/runtime/orch-012-runtime-test-last-message.txt",
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(lastMessagePath)).toBe(true);
    expect(result.lastMessage).toContain("TASK_DONE ORCH-012/runtime test");
    expect(readFileSync(lastMessagePath, "utf8")).toContain(
      "Captured terminal summary.",
    );
  });

  it("writes runtime status and heartbeat files next to the configured state file", () => {
    const repoRoot = createTempRepo();
    mkdirSync(join(repoRoot, "docs"), { recursive: true });
    writeFileSync(
      join(repoRoot, "docs/tasks.md"),
      `### Complete Runtime Status
- **ID**: \`ORCH-043\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None
`,
    );
    writeFileSync(join(repoRoot, "docs/decisions.md"), "# Decisions\n");
    writeFileSync(
      join(repoRoot, "fake-agent.cjs"),
      `const fs = require("node:fs");
const path = require("node:path");

let outputPath = null;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "-o" && process.argv[index + 1]) {
    outputPath = process.argv[index + 1];
    index += 1;
  }
}

if (!outputPath) {
  process.exit(2);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  "TASK_DONE " + process.env.ORCHESTRATOR_TASK_ID + "\\nRuntime status completed.\\n",
);
`,
    );
    writeFileSync(
      join(repoRoot, "WORKFLOW.md"),
      [
        "---",
        "name: runtime-health",
        "task_sources:",
        "  - docs/tasks.md",
        "decision_file: docs/decisions.md",
        "progress_file: .orchestrator/runtime/progress.md",
        "state_file: .orchestrator/runtime/state.json",
        "workspace_root: .orchestrator/runtime/workspaces",
        "workspace_mode: shared",
        `agent_command: "${process.execPath}"`,
        "agent_args:",
        "  - fake-agent.cjs",
        "max_iterations: 5",
        "poll_interval_seconds: 0",
        "completion_phrase: COMPLETE",
        "required_branch: main",
        "terminal_commit_behavior: per_task",
        "auto_push_every_commits: 0",
        "review_every_tasks: 0",
        "---",
        "# Workflow",
        "Write runtime health artifacts.",
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

    const exitCode = runOrchestratorLoop(
      {
        workflowFile: "WORKFLOW.md",
        maxIterations: 5,
        once: true,
        dryRun: false,
      },
      {
        repoRoot,
        log: () => undefined,
        error: () => undefined,
        sleep: () => undefined,
      },
    );
    const statusPath = join(repoRoot, ".orchestrator/runtime/status.json");
    const heartbeatPath = join(
      repoRoot,
      ".orchestrator/runtime/heartbeat.json",
    );
    const status = JSON.parse(readFileSync(statusPath, "utf8")) as {
      phase: string;
      activeTaskId: string | null;
      iteration: number;
      lastNote: string | null;
      retry: {
        activeFailureCount: number;
        activeTaskIds: string[];
      };
    };
    const heartbeat = JSON.parse(readFileSync(heartbeatPath, "utf8")) as {
      phase: string;
      activeTaskId: string | null;
      iteration: number;
      lastNote: string | null;
    };

    expect(exitCode).toBe(0);
    expect(existsSync(statusPath)).toBe(true);
    expect(existsSync(heartbeatPath)).toBe(true);
    expect(status).toMatchObject({
      phase: "completed",
      activeTaskId: null,
      iteration: 1,
      retry: {
        activeFailureCount: 0,
        activeTaskIds: [],
      },
    });
    expect(status.lastNote).toContain("All tracked tasks are complete.");
    expect(heartbeat).toMatchObject({
      phase: "completed",
      activeTaskId: null,
      iteration: 1,
    });
    expect(heartbeat.lastNote).toContain("All tracked tasks are complete.");
  });
});
