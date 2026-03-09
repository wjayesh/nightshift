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

const REVIEW_AGENT = `const fs = require("node:fs");
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

const prompt = fs.readFileSync(0, "utf8");
const taskDocPath = path.join(workspace, "docs/tasks.md");
const tick = String.fromCharCode(96);

if (process.env.ORCHESTRATOR_RUN_KIND === "review") {
  const reviewId = process.env.ORCHESTRATOR_REVIEW_ID || "review";
  fs.writeFileSync(
    path.join(workspace, ".review-prompt-" + reviewId + ".txt"),
    prompt,
  );
  let taskDoc = fs.readFileSync(taskDocPath, "utf8");
  if (!taskDoc.includes("REVIEW-FIX-001")) {
    taskDoc +=
      "\\n### Review Follow-up\\n" +
      "- **ID**: " + tick + "REVIEW-FIX-001" + tick + "\\n" +
      "- **Status**: " + tick + "pending" + tick + "\\n" +
      "- **Priority**: P0\\n" +
      "- **Depends on**: None\\n\\n" +
      "Fix the issues found during review.\\n";
    fs.writeFileSync(taskDocPath, taskDoc);
  }

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
      outputPath,
      "Reviewed TASK-001 and TASK-002.\\nCreated REVIEW-FIX-001.\\n",
    );
  }
  process.exit(0);
}

const taskId = process.env.ORCHESTRATOR_TASK_ID;
if (!taskId) {
  process.exit(2);
}

let taskDoc = fs.readFileSync(taskDocPath, "utf8");
const idMarker = "- **ID**: " + tick + taskId + tick;
const idIndex = taskDoc.indexOf(idMarker);
if (idIndex === -1) {
  process.exit(3);
}

const statusIndex = taskDoc.indexOf("- **Status**:", idIndex);
const statusLineEnd = taskDoc.indexOf("\\n", statusIndex);
taskDoc =
  taskDoc.slice(0, statusIndex) +
  "- **Status**: " + tick + "done" + tick +
  taskDoc.slice(statusLineEnd);
fs.writeFileSync(taskDocPath, taskDoc);
fs.appendFileSync(path.join(workspace, ".task-runs"), taskId + "\\n");

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    "TASK_DONE " + taskId + "\\nFinished " + taskId + ".\\n",
  );
}
`;

afterEach(() => {
  while (TEMP_REPOS.length > 0) {
    const repoRoot = TEMP_REPOS.pop();
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

function createRepo(reviewEveryTasks = 2): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "orchestrator-review-"));
  TEMP_REPOS.push(repoRoot);

  mkdirSync(join(repoRoot, "docs"), { recursive: true });
  writeFileSync(join(repoRoot, "fake-agent.cjs"), REVIEW_AGENT);
  writeFileSync(
    join(repoRoot, "docs/tasks.md"),
    `### First Task
- **ID**: \`TASK-001\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None

### Second Task
- **ID**: \`TASK-002\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: TASK-001

### Third Task
- **ID**: \`TASK-003\`
- **Status**: \`pending\`
- **Priority**: P1
- **Depends on**: TASK-002
`,
  );
  writeFileSync(join(repoRoot, "docs/decisions.md"), "# Decisions\n");
  writeFileSync(
    join(repoRoot, "WORKFLOW.md"),
    `---
name: review-loop
task_sources:
  - docs/tasks.md
decision_file: docs/decisions.md
progress_file: .orchestrator/progress.md
state_file: .orchestrator/state.json
workspace_root: .orchestrator/workspaces
workspace_mode: shared
agent_command: "${process.execPath}"
agent_args:
  - fake-agent.cjs
max_iterations: 4
poll_interval_seconds: 0
completion_phrase: COMPLETE
required_branch: main
terminal_commit_behavior: per_task
auto_push_every_commits: 0
review_every_tasks: ${reviewEveryTasks}
---
# Workflow
Review finished work every ${reviewEveryTasks} completed tasks.
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

function runGit(repoRoot: string, args: string[]) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("periodic review loop", () => {
  it("reviews the next completed batch, persists the outcome, and schedules remediation work", () => {
    const repoRoot = createRepo();
    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = runOrchestratorLoop(
      {
        workflowFile: "WORKFLOW.md",
        maxIterations: 3,
        once: false,
        dryRun: false,
      },
      {
        repoRoot,
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(logs.join("\n")).toContain("review-001 periodic review");
    expect(
      readFileSync(join(repoRoot, ".task-runs"), "utf8")
        .trim()
        .split("\n")
        .slice(0, 3),
    ).toEqual(["TASK-001", "TASK-002", "REVIEW-FIX-001"]);

    const reviewPrompt = readFileSync(
      join(repoRoot, ".review-prompt-review-001.txt"),
      "utf8",
    );
    expect(reviewPrompt).toContain("TASK-001 First Task");
    expect(reviewPrompt).toContain("TASK-002 Second Task");
    expect(reviewPrompt).toContain("TASK_DONE TASK-001");
    expect(reviewPrompt).toContain("TASK_DONE TASK-002");
    expect(reviewPrompt).not.toContain("TASK-003 Third Task");

    const taskDoc = readFileSync(join(repoRoot, "docs/tasks.md"), "utf8");
    expect(taskDoc).toContain("REVIEW-FIX-001");
    expect(taskDoc).toContain("- **Priority**: P0");

    const progress = readFileSync(
      join(repoRoot, ".orchestrator/progress.md"),
      "utf8",
    );
    expect(progress).toContain("| review-001 | review_started |");
    expect(progress).toContain("| review-001 | review_completed |");
    expect(
      readFileSync(join(repoRoot, ".orchestrator/reviews.md"), "utf8"),
    ).toContain("REVIEW-FIX-001");

    const state = JSON.parse(
      readFileSync(join(repoRoot, ".orchestrator/state.json"), "utf8"),
    ) as {
      lastReviewedCompletionCount: number;
      reviews: Array<{
        id: string;
        reviewedTaskIds: string[];
        remediationTaskIds: string[];
        lastMessageFile: string;
        note: string;
      }>;
      history: Array<{ status: string; taskId: string | null }>;
    };

    expect(state.lastReviewedCompletionCount).toBeGreaterThanOrEqual(2);
    expect(state.reviews.length).toBeGreaterThanOrEqual(1);
    const firstReview = state.reviews.find(
      (review) => review.id === "review-001",
    );
    expect(firstReview).toBeDefined();
    expect(firstReview).toMatchObject({
      id: "review-001",
      reviewedTaskIds: ["TASK-001", "TASK-002"],
      remediationTaskIds: ["REVIEW-FIX-001"],
    });
    expect(firstReview?.lastMessageFile).toBe(
      ".orchestrator/review-001-last-message.txt",
    );
    expect(firstReview?.note).toContain(
      "Created remediation tasks: REVIEW-FIX-001.",
    );
    expect(
      state.history.some(
        (entry) =>
          entry.status === "review_started" && entry.taskId === "review-001",
      ),
    ).toBe(true);
    expect(
      state.history.some(
        (entry) =>
          entry.status === "review_completed" && entry.taskId === "review-001",
      ),
    ).toBe(true);

    expect(
      readFileSync(
        join(repoRoot, ".orchestrator/review-001-last-message.txt"),
        "utf8",
      ),
    ).toContain("Created REVIEW-FIX-001.");
  });

  it("runs a due review before returning from --once", () => {
    const repoRoot = createRepo(1);
    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = runOrchestratorLoop(
      {
        workflowFile: "WORKFLOW.md",
        maxIterations: 5,
        once: true,
        dryRun: false,
      },
      {
        repoRoot,
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(logs.join("\n")).toContain("review-001 periodic review");
    expect(readFileSync(join(repoRoot, ".task-runs"), "utf8")).toBe(
      "TASK-001\n",
    );
    expect(readFileSync(join(repoRoot, "docs/tasks.md"), "utf8")).toContain(
      "REVIEW-FIX-001",
    );

    const state = JSON.parse(
      readFileSync(join(repoRoot, ".orchestrator/state.json"), "utf8"),
    ) as {
      lastReviewedCompletionCount: number;
      reviews: Array<{ id: string }>;
    };

    expect(state.lastReviewedCompletionCount).toBe(1);
    expect(state.reviews).toHaveLength(1);
    expect(state.reviews[0]).toMatchObject({ id: "review-001" });
    expect(
      readFileSync(join(repoRoot, ".orchestrator/reviews.md"), "utf8"),
    ).toContain("## review-001");
  });
});
