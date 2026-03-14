import {
  existsSync,
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

function createAgentScript(message: string | null, exitCode = 0) {
  return `const fs = require("node:fs");
const path = require("node:path");

let outputPath = null;

for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o" && process.argv[index + 1]) {
    outputPath = process.argv[index + 1];
    index += 1;
  }
}

if (outputPath && ${message !== null}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, ${JSON.stringify(message)});
}

process.exit(${exitCode});
`;
}

function runGit(repoRoot: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function createRepo(agentScript: string): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "orchestrator-terminal-"));
  TEMP_REPOS.push(repoRoot);

  mkdirSync(join(repoRoot, "docs"), { recursive: true });
  writeFileSync(join(repoRoot, ".gitignore"), ".orchestrator/\n");
  writeFileSync(join(repoRoot, "fake-agent.cjs"), agentScript);
  writeFileSync(
    join(repoRoot, "docs/tasks.md"),
    `### Terminal Parsing Task
- **ID**: \`TASK-001\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None
`,
  );
  writeFileSync(join(repoRoot, "docs/decisions.md"), "# Decisions\n");
  writeFileSync(
    join(repoRoot, "WORKFLOW.md"),
    `---
name: terminal-message-guard
task_sources:
  - docs/tasks.md
decision_file: docs/decisions.md
progress_file: .orchestrator/progress.md
state_file: .orchestrator/state.json
workspace_root: .orchestrator/workspaces
workspace_mode: git_worktree
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
Exercise terminal message parsing safeguards.
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

afterEach(() => {
  while (TEMP_REPOS.length > 0) {
    const repoRoot = TEMP_REPOS.pop();
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

describe("terminal message safeguards", () => {
  it("ignores TASK_DONE substrings that are not exact terminal lines", () => {
    const repoRoot = createRepo(
      createAgentScript(
        "I cannot honestly say TASK_DONE TASK-001 because the acceptance criteria are not met.\\n",
      ),
    );
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
      "- **Status**: `pending`",
    );
    expect(
      runGit(repoRoot, ["rev-list", "--count", "HEAD"]).stdout.trim(),
    ).toBe("1");
  });

  it("ignores TASK_BLOCKED substrings that are not exact terminal lines", () => {
    const repoRoot = createRepo(
      createAgentScript(
        "Do not treat TASK_BLOCKED TASK-001: this is only an example line.\\n",
      ),
    );
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
      "- **Status**: `pending`",
    );
    expect(
      runGit(repoRoot, ["rev-list", "--count", "HEAD"]).stdout.trim(),
    ).toBe("1");
  });

  it("clears stale last-message files before each run", () => {
    const repoRoot = createRepo(createAgentScript(null));
    const errors: string[] = [];
    const lastMessagePath = join(
      repoRoot,
      ".orchestrator/task-001-last-message.txt",
    );

    mkdirSync(join(repoRoot, ".orchestrator"), { recursive: true });
    writeFileSync(lastMessagePath, "TASK_DONE TASK-001\n");

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
      "- **Status**: `pending`",
    );
    expect(
      runGit(repoRoot, ["rev-list", "--count", "HEAD"]).stdout.trim(),
    ).toBe("1");
    expect(existsSync(lastMessagePath)).toBe(false);
  });
});
