import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendProgress,
  loadState,
  parseTaskFile,
  parseWorkflowFile,
  runAgentForTask,
  saveState,
} from "../../src/orchestrator";

const TEMP_DIRS: string[] = [];

function createTempRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "orchestrator-runtime-"));
  TEMP_DIRS.push(repoRoot);
  return repoRoot;
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
});
