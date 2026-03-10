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
import { afterEach, describe, expect, it, vi } from "vitest";
import { runOrchestratorCli } from "../../src/orchestrator";

const TEMP_REPOS: string[] = [];

const DOGFOOD_AGENT = `const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
const runKind = process.env.ORCHESTRATOR_RUN_KIND || "task";
const taskId = process.env.ORCHESTRATOR_TASK_ID || "";
const reviewId = process.env.ORCHESTRATOR_REVIEW_ID || "";
const runsPath = path.join(repoRoot, ".orchestrator/runtime/agent-runs.json");
const taskDocPath = path.join(workspace, "docs/tasks.md");
const decisionDocPath = path.join(workspace, "docs/decisions.md");

function loadRuns() {
  if (!fs.existsSync(runsPath)) {
    return { taskRuns: {}, reviewRuns: {} };
  }
  return JSON.parse(fs.readFileSync(runsPath, "utf8"));
}

function saveRuns(value) {
  fs.mkdirSync(path.dirname(runsPath), { recursive: true });
  fs.writeFileSync(runsPath, JSON.stringify(value, null, 2) + "\\n");
}

function incrementRun(bucket, id) {
  const runs = loadRuns();
  const current = Number(runs[bucket][id] || 0) + 1;
  runs[bucket][id] = current;
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

function recordWorkspaceHead(slug, run) {
  const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: workspace,
    encoding: "utf8",
  });
  if (headResult.status !== 0) {
    process.exit(headResult.status || 1);
  }

  const headPath = path.join(
    repoRoot,
    ".orchestrator/runtime",
    slug + "-workspace-head-" + run + ".txt",
  );
  fs.mkdirSync(path.dirname(headPath), { recursive: true });
  fs.writeFileSync(headPath, headResult.stdout.trim() + "\\n");
}

if (runKind === "review") {
  incrementRun("reviewRuns", reviewId || "review");
  const tick = String.fromCharCode(96);
  if (reviewId === "review-001") {
    let taskDoc = fs.readFileSync(taskDocPath, "utf8");
    if (!taskDoc.includes("- **ID**: " + tick + "REVIEW-001-01" + tick)) {
      taskDoc +=
        "\\n### Document operator recovery follow-up\\n" +
        "- **ID**: " + tick + "REVIEW-001-01" + tick + "\\n" +
        "- **Status**: " + tick + "pending" + tick + "\\n" +
        "- **Priority**: P0\\n" +
        "- **Depends on**: DOG-001, DOG-002\\n\\n" +
        "Capture the retry and stale-workspace recovery drill exposed during dogfood.\\n" +
        "Reproduction: Run the standalone dogfood fixture, inspect progress/state/status artifacts, and confirm the operator handoff still reads cleanly.\\n";
      fs.writeFileSync(taskDocPath, taskDoc);
    }

    ensureOutput(
      "REVIEW_DONE: REVIEW-001-01\\nCreated REVIEW-001-01 from the first dogfood review batch.\\n",
    );
    process.exit(0);
  }

  ensureOutput(
    "REVIEW_DONE: none\\nNo additional remediation tasks were required for " +
      (reviewId || "review") +
      ".\\n",
  );
  process.exit(0);
}

const run = incrementRun("taskRuns", taskId);

if (taskId === "DOG-001") {
  fs.writeFileSync(
    path.join(workspace, "shared.txt"),
    "DOG-001 integration baseline\\n",
  );
  ensureDecisionEntry(
    "DOG-001",
    "Bootstrap fixture decisions",
    "The dogfood fixture needs a tracked change plus a durable decision entry so the orchestrator validates both git integration and decision logging in the same run.",
    "Seed the shared baseline file from DOG-001 and append a concise decision entry from the task workspace.",
    "Later tasks and reviews can validate both the integrated file change and the durable decision record without relying on synthetic artifacts alone.",
  );
  ensureOutput(
    "TASK_DONE DOG-001\\nBootstrapped the dogfood fixture and recorded a decision entry.\\n",
  );
  process.exit(0);
}

if (taskId === "DOG-002") {
  if (run === 1) {
    ensureOutput(
      "Transient dependency check failed before the retry window opened.\\n",
    );
    process.exit(1);
  }

  fs.writeFileSync(
    path.join(workspace, "retry-recovery.txt"),
    "DOG-002 recovered after retry backoff\\n",
  );
  ensureOutput(
    "TASK_DONE DOG-002\\nRecovered after the configured retry backoff.\\n",
  );
  process.exit(0);
}

if (taskId === "REVIEW-001-01") {
  fs.writeFileSync(
    path.join(workspace, "review-remediation.txt"),
    "REVIEW-001-01 captured the operator-facing recovery note\\n",
  );
  ensureOutput(
    "TASK_DONE REVIEW-001-01\\nRecorded the operator recovery follow-up from review-001.\\n",
  );
  process.exit(0);
}

if (taskId === "DOG-003") {
  fs.writeFileSync(
    path.join(workspace, "release-plan.txt"),
    "DOG-003 consumed the review follow-up before release handoff\\n",
  );
  ensureDecisionEntry(
    "DOG-003",
    "Carry review remediation into the release flow",
    "The dogfood fixture should prove that review-created remediation can gate later work instead of becoming a detached side note.",
    "Make DOG-003 depend on REVIEW-001-01 and record a second decision once that remediation is folded into the release plan.",
    "The end-to-end run now exercises dependency-aware task selection across both original tasks and review-created follow-up work.",
  );
  ensureOutput(
    "TASK_DONE DOG-003\\nFolded the review follow-up into the release plan.\\n",
  );
  process.exit(0);
}

if (taskId === "DOG-004") {
  recordWorkspaceHead("dog-004", run);
  if (run === 1) {
    ensureOutput(
      "TASK_DONE DOG-004\\nFirst pass attempted to integrate a stale task workspace.\\n",
    );
    process.exit(0);
  }

  fs.writeFileSync(
    path.join(workspace, "shared.txt"),
    "DOG-001 integration baseline\\nDOG-004 recovered after workspace refresh\\n",
  );
  ensureOutput(
    "TASK_DONE DOG-004\\nRecovered after workspace refresh.\\n",
  );
  process.exit(0);
}

process.exit(3);
`;

type DogfoodState = {
  history: Array<{ taskId: string | null; status: string; note: string }>;
  reviews: Array<{
    id: string;
    reviewedTaskIds: string[];
    remediationTaskIds: string[];
    lastMessageFile: string;
    note: string;
  }>;
  taskFailures: Record<string, unknown>;
  iteration: number;
  lastReviewedCompletionCount: number;
};

type RuntimeStatus = {
  phase: string;
  activeTaskId: string | null;
  iteration: number;
  lastNote: string | null;
  lastError: string | null;
  lastHistoryStatus: string | null;
  retry: {
    limit: number;
    baseBackoffSeconds: number;
    activeFailureCount: number;
    activeTaskIds: string[];
    waitingTaskIds: string[];
    exhaustedTaskIds: string[];
  };
};

type AgentRuns = {
  taskRuns: Record<string, number>;
  reviewRuns: Record<string, number>;
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

function createDogfoodRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "orchestrator-dogfood-"));
  TEMP_REPOS.push(repoRoot);

  mkdirSync(join(repoRoot, "docs"), { recursive: true });
  writeFileSync(join(repoRoot, ".gitignore"), ".orchestrator/\n");
  writeFileSync(join(repoRoot, "shared.txt"), "seed baseline\n");
  writeFileSync(
    join(repoRoot, "docs/tasks.md"),
    `### Bootstrap fixture decisions
- **ID**: \`DOG-001\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None

Record the first tracked change plus a durable decision entry.

### Recover a transient agent failure
- **ID**: \`DOG-002\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: DOG-001

Fail once so the orchestrator must schedule a retry with backoff.

### Fold review follow-up into the release plan
- **ID**: \`DOG-003\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: DOG-002, REVIEW-001-01

Wait for the first review remediation task before continuing.

### Recover stale workspace after integration drift
- **ID**: \`DOG-004\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: DOG-003

Rebuild a stale task workspace after a cherry-pick conflict.
`,
  );
  writeFileSync(join(repoRoot, "docs/decisions.md"), "# Decisions\n");
  writeFileSync(join(repoRoot, "fake-agent.cjs"), DOGFOOD_AGENT);
  writeFileSync(
    join(repoRoot, "WORKFLOW.md"),
    [
      "---",
      "name: dogfood-standalone",
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
      "max_iterations: 20",
      "poll_interval_seconds: 0",
      "completion_phrase: COMPLETE",
      "required_branch: main",
      "terminal_commit_behavior: per_task",
      "auto_push_every_commits: 0",
      "review_every_tasks: 2",
      "task_failure_retry_limit: 3",
      "task_failure_backoff_seconds: 5",
      "---",
      "# Workflow",
      "Dogfood the standalone orchestrator against a dependency-heavy fixture.",
      "",
    ].join("\n"),
  );

  expect(runGit(repoRoot, ["init", "-b", "main"]).status).toBe(0);
  expect(
    runGit(repoRoot, ["config", "user.email", "orchestrator@example.com"])
      .status,
  ).toBe(0);
  expect(
    runGit(repoRoot, ["config", "user.name", "Orchestrator Dogfood Test"])
      .status,
  ).toBe(0);
  expect(runGit(repoRoot, ["add", "-A"]).status).toBe(0);
  expect(
    runGit(repoRoot, ["commit", "-m", "initial dogfood fixture"]).status,
  ).toBe(0);

  return repoRoot;
}

function seedStaleDogfoodWorkspace(repoRoot: string) {
  const workspacePath = join(
    repoRoot,
    ".orchestrator/runtime/workspaces/dog-004",
  );
  expect(
    runGit(repoRoot, [
      "worktree",
      "add",
      "-B",
      "orchestrator-dog-004",
      workspacePath,
      "main",
    ]).status,
  ).toBe(0);
  writeFileSync(join(workspacePath, "shared.txt"), "DOG-004 stale seed\n");
  expect(runGit(workspacePath, ["add", "shared.txt"]).status).toBe(0);
  expect(
    runGit(workspacePath, ["commit", "-m", "dog-004 stale seed"]).status,
  ).toBe(0);

  return {
    workspacePath,
    staleHead: runGit(workspacePath, ["rev-parse", "HEAD"]).stdout.trim(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  while (TEMP_REPOS.length > 0) {
    const repoRoot = TEMP_REPOS.pop();
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

describe("standalone orchestrator dogfood", () => {
  it("runs the full worker loop through review, retry backoff, runtime artifacts, and stale-workspace recovery", () => {
    vi.useFakeTimers();

    const repoRoot = createDogfoodRepo();
    const { workspacePath, staleHead } = seedStaleDogfoodWorkspace(repoRoot);
    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = runOrchestratorCli(
      ["--workflow", "WORKFLOW.md", "--max-iterations", "20"],
      {
        repoRoot,
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
        sleep: (milliseconds) => {
          vi.advanceTimersByTime(milliseconds);
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(logs.join("\n")).toContain("review-001 periodic review");
    expect(logs.join("\n")).toContain("review-002 periodic review");
    expect(logs.join("\n")).toContain("COMPLETE");

    const taskDoc = readFileSync(join(repoRoot, "docs/tasks.md"), "utf8");
    expect((taskDoc.match(/- \*\*ID\*\*:/g) ?? []).length).toBe(5);
    expect((taskDoc.match(/- \*\*Status\*\*: `done`/g) ?? []).length).toBe(5);
    expect(taskDoc).toContain("REVIEW-001-01");
    expect(taskDoc.lastIndexOf("REVIEW-001-01")).toBeGreaterThan(
      taskDoc.lastIndexOf("DOG-004"),
    );

    const decisions = readFileSync(join(repoRoot, "docs/decisions.md"), "utf8");
    expect(decisions).toContain(
      "## 2026-03-10 - DOG-001 - Bootstrap fixture decisions",
    );
    expect(decisions).toContain(
      "## 2026-03-10 - DOG-003 - Carry review remediation into the release flow",
    );

    const progress = readFileSync(
      join(repoRoot, ".orchestrator/runtime/progress.md"),
      "utf8",
    );
    expect(progress).toContain("| DOG-002 | retry_scheduled |");
    expect(progress).toContain("after 5s backoff");
    expect(progress).toContain("Waiting to retry DOG-002 at");
    expect(progress).toContain("| review-001 | review_completed |");
    expect(progress).toContain("| review-002 | review_completed |");
    expect(progress).toContain(
      "DOG-004 integration hit a cherry-pick content conflict",
    );
    expect(progress).toContain("workspace is marked stale");

    const state = readJson<DogfoodState>(
      join(repoRoot, ".orchestrator/runtime/state.json"),
    );
    expect(state.iteration).toBe(9);
    expect(state.taskFailures).toEqual({});
    expect(state.lastReviewedCompletionCount).toBe(4);
    expect(state.reviews).toHaveLength(2);
    expect(state.reviews[0]).toMatchObject({
      id: "review-001",
      reviewedTaskIds: ["DOG-001", "DOG-002"],
      remediationTaskIds: ["REVIEW-001-01"],
      lastMessageFile: ".orchestrator/runtime/review-001-last-message.txt",
    });
    expect(state.reviews[0]?.note).toContain(
      "Created remediation tasks: REVIEW-001-01.",
    );
    expect(state.reviews[1]).toMatchObject({
      id: "review-002",
      reviewedTaskIds: ["REVIEW-001-01", "DOG-003"],
      remediationTaskIds: [],
      lastMessageFile: ".orchestrator/runtime/review-002-last-message.txt",
    });
    expect(
      state.history.map((entry) => `${entry.taskId}:${entry.status}`),
    ).toEqual([
      "DOG-001:completed",
      "DOG-002:retry_scheduled",
      "DOG-002:completed",
      "review-001:review_started",
      "review-001:review_completed",
      "REVIEW-001-01:completed",
      "DOG-003:completed",
      "review-002:review_started",
      "review-002:review_completed",
      "DOG-004:retry_scheduled",
      "DOG-004:completed",
    ]);

    const status = readJson<RuntimeStatus>(
      join(repoRoot, ".orchestrator/runtime/status.json"),
    );
    const heartbeat = readJson<RuntimeStatus>(
      join(repoRoot, ".orchestrator/runtime/heartbeat.json"),
    );
    expect(status).toMatchObject({
      phase: "completed",
      activeTaskId: null,
      iteration: 9,
      lastHistoryStatus: "completed",
      retry: {
        limit: 3,
        baseBackoffSeconds: 5,
        activeFailureCount: 0,
        activeTaskIds: [],
        waitingTaskIds: [],
        exhaustedTaskIds: [],
      },
    });
    expect(status.lastNote).toContain("All tracked tasks are complete.");
    expect(status.lastError).toBeNull();
    expect(heartbeat).toMatchObject({
      phase: "completed",
      activeTaskId: null,
      iteration: 9,
    });
    expect(heartbeat.lastNote).toContain("All tracked tasks are complete.");

    for (const fileName of [
      "dog-001-last-message.txt",
      "dog-002-last-message.txt",
      "review-001-last-message.txt",
      "review-001-01-last-message.txt",
      "dog-003-last-message.txt",
      "review-002-last-message.txt",
      "dog-004-last-message.txt",
    ]) {
      expect(
        existsSync(join(repoRoot, ".orchestrator/runtime", fileName)),
      ).toBe(true);
    }
    expect(
      readFileSync(
        join(repoRoot, ".orchestrator/runtime/dog-004-last-message.txt"),
        "utf8",
      ),
    ).toContain("Recovered after workspace refresh.");

    const agentRuns = readJson<AgentRuns>(
      join(repoRoot, ".orchestrator/runtime/agent-runs.json"),
    );
    expect(agentRuns.taskRuns).toMatchObject({
      "DOG-001": 1,
      "DOG-002": 2,
      "REVIEW-001-01": 1,
      "DOG-003": 1,
      "DOG-004": 2,
    });
    expect(agentRuns.reviewRuns).toMatchObject({
      "review-001": 1,
      "review-002": 1,
    });

    const firstWorkspaceHead = readFileSync(
      join(repoRoot, ".orchestrator/runtime/dog-004-workspace-head-1.txt"),
      "utf8",
    ).trim();
    const secondWorkspaceHead = readFileSync(
      join(repoRoot, ".orchestrator/runtime/dog-004-workspace-head-2.txt"),
      "utf8",
    ).trim();
    expect(firstWorkspaceHead).toBe(staleHead);
    expect(secondWorkspaceHead).toBe(
      runGit(repoRoot, ["rev-parse", "HEAD^"]).stdout.trim(),
    );
    expect(secondWorkspaceHead).not.toBe(firstWorkspaceHead);
    expect(readFileSync(join(workspacePath, "shared.txt"), "utf8")).toContain(
      "DOG-004 recovered after workspace refresh",
    );
    expect(existsSync(join(workspacePath, "release-plan.txt"))).toBe(true);
    expect(runGit(workspacePath, ["log", "--format=%s"]).stdout).not.toContain(
      "dog-004 stale seed",
    );

    const gitLog = runGit(repoRoot, ["log", "--format=%s"]).stdout;
    expect(gitLog).toContain(
      "orchestrator: review review-001 Reviewed DOG-001, DOG-002",
    );
    expect(gitLog).toContain(
      "orchestrator: complete DOG-004 Recover stale workspace after integration drift",
    );
  });
});
