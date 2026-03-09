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
import { spawnSync } from "node:child_process";
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
  return `---
name: cli-test
task_sources:
  - ${taskSource}
progress_file: .orchestrator/progress.md
state_file: .orchestrator/state.json
workspace_root: .orchestrator/workspaces
workspace_mode: shared
agent_command: "${RUNTIME_BINARY}"
agent_args:
  - fake-agent.cjs
max_iterations: 10
poll_interval_seconds: 0
completion_phrase: COMPLETE
auto_commit_on_done: false
auto_push_every_commits: 0
---
# Workflow
Exercise the standalone CLI entrypoint.
`;
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
});
