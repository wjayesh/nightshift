import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTaskPrompt,
  getRuntimeRoot,
  mergeTaskUniverses,
  parseTaskFile,
  parseWorkflowFile,
  selectNextTask,
} from "../../src/orchestrator";

describe("parseWorkflowFile", () => {
  it("parses front matter arrays and scalars", () => {
    const workflow = parseWorkflowFile(`---
name: sample
max_iterations: 5
task_sources:
  - docs/a.md
dependency_sources:
  - docs/b.md
instruction_files:
  - CLAUDE.md
decision_file: docs/records/decisions.md
workspace_mode: shared
terminal_commit_behavior: per_task
auto_push_every_commits: 5
review_every_tasks: 4
required_branch: autonomous/server-integration
---
# Workflow\nBody here.\n`);

    expect(workflow.name).toBe("sample");
    expect(workflow.maxIterations).toBe(5);
    expect(workflow.taskSources).toEqual(["docs/a.md"]);
    expect(workflow.dependencySources).toEqual(["docs/b.md"]);
    expect(workflow.instructionFiles).toEqual(["CLAUDE.md"]);
    expect(workflow.decisionFile).toBe("docs/records/decisions.md");
    expect(workflow.workspaceMode).toBe("shared");
    expect(workflow.terminalCommitBehavior).toBe("per_task");
    expect(workflow.autoPushEveryCommits).toBe(5);
    expect(workflow.reviewEveryTasks).toBe(4);
    expect(workflow.requiredBranch).toBe("autonomous/server-integration");
    expect(workflow.workflowBody).toContain("Body here");
  });

  it("falls back to standalone defaults when fields are omitted", () => {
    const workflow = parseWorkflowFile(
      "# Workflow\nUse the default standalone layout.\n",
    );

    expect(workflow.name).toBe("autonomous-development");
    expect(workflow.taskSources).toEqual(["docs/tasks.md"]);
    expect(workflow.dependencySources).toEqual([]);
    expect(workflow.instructionFiles).toEqual([]);
    expect(workflow.decisionFile).toBe("docs/decisions.md");
    expect(workflow.progressFile).toBe(".orchestrator/progress.md");
    expect(workflow.stateFile).toBe(".orchestrator/state.json");
    expect(workflow.workspaceRoot).toBe(".orchestrator/workspaces");
    expect(workflow.agentArgs).toEqual(["exec"]);
    expect(workflow.terminalCommitBehavior).toBe("per_task");
    expect(workflow.reviewEveryTasks).toBe(3);
  });

  it("accepts single-path workflow fields without list syntax", () => {
    const workflow = parseWorkflowFile(`---
task_sources: docs/tasks.md
dependency_sources: docs/dependencies.md
instruction_files: docs/instructions.md
decision_file: docs/records/decisions.md
agent_args: --json
state_file: runtime/state.json
---
# Workflow
`);

    expect(workflow.taskSources).toEqual(["docs/tasks.md"]);
    expect(workflow.dependencySources).toEqual(["docs/dependencies.md"]);
    expect(workflow.instructionFiles).toEqual(["docs/instructions.md"]);
    expect(workflow.decisionFile).toEqual("docs/records/decisions.md");
    expect(workflow.agentArgs).toEqual(["--json"]);
    expect(getRuntimeRoot("/repo", workflow)).toBe(join("/repo", "runtime"));
  });

  it("rejects unsupported terminal commit behavior values", () => {
    expect(() =>
      parseWorkflowFile(`---
terminal_commit_behavior: manual
---
# Workflow
`),
    ).toThrow(/terminal_commit_behavior/);
  });

  it("rejects unsupported review cadence values", () => {
    expect(() =>
      parseWorkflowFile(`---
review_every_tasks: later
---
# Workflow
`),
    ).toThrow(/review_every_tasks/);
  });
});

describe("task parsing and selection", () => {
  const taskDoc = `## Phase 0

### 0.1 First Task
- **ID**: \`TASK-001\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None

### 0.2 Second Task
- **ID**: \`TASK-002\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: TASK-001

### 0.3 Third Task
- **ID**: \`TASK-003\`
- **Status**: \`in-progress\`
- **Priority**: P1
- **Depends on**: None
`;

  it("parses task metadata", () => {
    const tasks = parseTaskFile(taskDoc, "docs/sample.md");
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      id: "TASK-001",
      status: "pending",
      priority: "P0",
      dependsOn: [],
      filePath: "docs/sample.md",
    });
    expect(tasks[1].dependsOn).toEqual(["TASK-001"]);
  });

  it("parses comma-separated Depends on metadata", () => {
    const [task] = parseTaskFile(
      `### 0.4 Fourth Task
- **ID**: \`TASK-004\`
- **Status**: \`pending\`
- **Priority**: P1
- **Depends on**: \`TASK-001\`, TASK-002
`,
      "docs/sample.md",
    );

    expect(task.dependsOn).toEqual(["TASK-001", "TASK-002"]);
  });

  it("prefers the active or in-progress task", () => {
    const tasks = parseTaskFile(taskDoc, "docs/sample.md");
    expect(selectNextTask(tasks, null)?.id).toBe("TASK-003");
    expect(selectNextTask(tasks, "TASK-001")?.id).toBe("TASK-001");
  });

  it("selects the next ready pending task when nothing is active", () => {
    const tasks = parseTaskFile(
      taskDoc.replace("- **Status**: `in-progress`", "- **Status**: `done`"),
      "docs/sample.md",
    );
    expect(selectNextTask(tasks, null)?.id).toBe("TASK-001");
  });

  it("uses dependency sources to unlock cross-doc tasks", () => {
    const pluginTasks = parseTaskFile(
      `### Plugin Task\n- **ID**: \`PLG-001\`\n- **Status**: \`pending\`\n- **Priority**: P0\n- **Depends on**: SRV-001\n`,
      "docs/plugin.md",
    );
    const serverTasks = parseTaskFile(
      `### Server Task\n- **ID**: \`SRV-001\`\n- **Status**: \`done\`\n- **Priority**: P0\n- **Depends on**: None\n`,
      "docs/server.md",
    );
    const universe = mergeTaskUniverses(pluginTasks, serverTasks);
    expect(selectNextTask(pluginTasks, null, universe)?.id).toBe("PLG-001");
  });

  it("keeps cross-doc tasks blocked until dependency sources are done", () => {
    const pluginTasks = parseTaskFile(
      `### Plugin Task\n- **ID**: \`PLG-001\`\n- **Status**: \`pending\`\n- **Priority**: P0\n- **Depends on**: SRV-001\n`,
      "docs/plugin.md",
    );
    const serverTasks = parseTaskFile(
      `### Server Task\n- **ID**: \`SRV-001\`\n- **Status**: \`pending\`\n- **Priority**: P0\n- **Depends on**: None\n`,
      "docs/server.md",
    );

    const universe = mergeTaskUniverses(pluginTasks, serverTasks);
    expect(selectNextTask(pluginTasks, null, universe)).toBeNull();
  });

  it("renders a prompt without requiring instruction files", () => {
    const [task] = parseTaskFile(
      `## Extract Core\n- **ID**: \`ORCH-010\`\n- **Status**: \`pending\`\n- **Priority**: P0\n- **Depends on**: None\n`,
      "docs/tasks.md",
    );
    const workflow = parseWorkflowFile(
      "# Workflow\nExtract the standalone core.\n",
    );
    const prompt = buildTaskPrompt(workflow, task, "/repo");

    expect(prompt).toContain("Instruction files to read first:\n- None");
    expect(prompt).toContain("Decision doc:\n- Path: docs/decisions.md");
    expect(prompt).toContain("## YYYY-MM-DD - ORCH-010 - Short decision title");
    expect(prompt).toContain(
      "Update docs/decisions.md if you make or revise a consequential implementation decision.",
    );
    expect(prompt).toContain(
      "Do not edit task-tracker status metadata in docs/tasks.md",
    );
    expect(prompt).toContain(
      "let the orchestrator record terminal `done` or `blocked` status on the integration branch.",
    );
    expect(prompt).not.toContain("Update the task status in docs/tasks.md");
    expect(prompt).toContain("Task ID: ORCH-010");
  });
});
