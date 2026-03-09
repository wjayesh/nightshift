import {
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
import { runOrchestratorLoop } from "../../src/orchestrator";

const TEMP_REPOS: string[] = [];

function createTaskAgent(outcome: "done" | "blocked") {
  return `const fs = require("node:fs");
const path = require("node:path");
const outcome = ${JSON.stringify(outcome)};

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

const taskId = process.env.ORCHESTRATOR_TASK_ID;
if (!taskId) {
  process.exit(2);
}

const finalMessage =
  outcome === "done"
    ? "TASK_DONE " + taskId + "\\nFinished " + taskId + ".\\n"
    : "TASK_BLOCKED " + taskId + ": Waiting on dependency.\\n";

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    finalMessage,
  );
}
`;
}

afterEach(() => {
  while (TEMP_REPOS.length > 0) {
    const repoRoot = TEMP_REPOS.pop();
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

function runGit(repoRoot: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function createRepo(
  workspaceMode: "shared" | "git_worktree",
  outcome: "done" | "blocked" = "done",
): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "orchestrator-git-"));
  TEMP_REPOS.push(repoRoot);

  mkdirSync(join(repoRoot, "docs"), { recursive: true });
  writeFileSync(join(repoRoot, ".gitignore"), ".orchestrator/\n");
  writeFileSync(join(repoRoot, "fake-agent.cjs"), createTaskAgent(outcome));
  writeFileSync(
    join(repoRoot, "docs/tasks.md"),
    `### First Task
- **ID**: \`TASK-001\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None
`,
  );
  writeFileSync(join(repoRoot, "docs/decisions.md"), "# Decisions\n");
  writeFileSync(join(repoRoot, "notes.txt"), "tracked note\n");
  writeFileSync(
    join(repoRoot, "WORKFLOW.md"),
    `---
name: dirty-integration-guard
task_sources:
  - docs/tasks.md
decision_file: docs/decisions.md
progress_file: .orchestrator/progress.md
state_file: .orchestrator/state.json
workspace_root: .orchestrator/workspaces
workspace_mode: ${workspaceMode}
agent_command: "${process.execPath}"
agent_args:
  - fake-agent.cjs
max_iterations: 1
poll_interval_seconds: 0
completion_phrase: COMPLETE
required_branch: main
terminal_commit_behavior: per_task
auto_push_every_commits: 0
review_every_tasks: 0
---
# Workflow
Exercise git integration behavior.
`,
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

describe("git integration dirty checkout guard", () => {
  it("refuses git-worktree integration when the shared checkout is dirty", () => {
    const repoRoot = createRepo("git_worktree");
    const errors: string[] = [];

    writeFileSync(join(repoRoot, "notes.txt"), "tracked note\ndirty change\n");
    writeFileSync(join(repoRoot, "scratch.txt"), "untracked change\n");

    const exitCode = runOrchestratorLoop(
      {
        workflowFile: "WORKFLOW.md",
        maxIterations: 1,
        once: true,
        dryRun: false,
      },
      {
        repoRoot,
        log: () => undefined,
        error: (message) => errors.push(message),
      },
    );

    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("TASK-001 cannot update main");
    expect(errors[0]).toContain(
      "shared integration checkout has uncommitted changes",
    );
    expect(errors[0]).toContain("M notes.txt");
    expect(errors[0]).toContain("?? scratch.txt");
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `pending`",
    );
    expect(
      runGit(repoRoot, ["rev-list", "--count", "HEAD"]).stdout.trim(),
    ).toBe("1");
  });

  it("does not block shared-workspace direct commits when the checkout is dirty", () => {
    const repoRoot = createRepo("shared");
    const errors: string[] = [];

    writeFileSync(join(repoRoot, "notes.txt"), "tracked note\ndirty change\n");
    writeFileSync(join(repoRoot, "scratch.txt"), "untracked change\n");

    const exitCode = runOrchestratorLoop(
      {
        workflowFile: "WORKFLOW.md",
        maxIterations: 1,
        once: true,
        dryRun: false,
      },
      {
        repoRoot,
        log: () => undefined,
        error: (message) => errors.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `done`",
    );
    expect(readFileSync(join(repoRoot, "scratch.txt"), "utf8")).toBe(
      "untracked change\n",
    );
    expect(runGit(repoRoot, ["status", "--short"]).stdout.trim()).toBe("");
    expect(runGit(repoRoot, ["log", "-1", "--pretty=%s"]).stdout.trim()).toBe(
      "orchestrator: complete TASK-001 First Task",
    );
  });

  it("records blocked tracker status on the integration branch for git-worktree runs", () => {
    const repoRoot = createRepo("git_worktree", "blocked");
    const errors: string[] = [];

    const exitCode = runOrchestratorLoop(
      {
        workflowFile: "WORKFLOW.md",
        maxIterations: 1,
        once: true,
        dryRun: false,
      },
      {
        repoRoot,
        log: () => undefined,
        error: (message) => errors.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "- **Status**: `blocked`",
    );
    expect(runGit(repoRoot, ["status", "--short"]).stdout.trim()).toBe("");
    expect(
      runGit(repoRoot, ["rev-list", "--count", "HEAD"]).stdout.trim(),
    ).toBe("2");
    expect(runGit(repoRoot, ["log", "-1", "--pretty=%s"]).stdout.trim()).toBe(
      "orchestrator: block TASK-001 First Task",
    );
  });
});
