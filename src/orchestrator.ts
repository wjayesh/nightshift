import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export type TaskStatus =
  | "pending"
  | "in-progress"
  | "blocked"
  | "review"
  | "done";

export type TaskPriority = `P${number}` | "unscored";

export type WorkflowConfig = {
  name: string;
  taskSources: string[];
  dependencySources: string[];
  instructionFiles: string[];
  decisionFile: string;
  progressFile: string;
  stateFile: string;
  workspaceRoot: string;
  workspaceMode: "shared" | "git_worktree";
  agentCommand: string;
  agentArgs: string[];
  maxIterations: number;
  pollIntervalSeconds: number;
  completionPhrase: string;
  requiredBranch: string | null;
  autoCommitOnDone: boolean;
  autoPushEveryCommits: number;
  workflowBody: string;
  workflowPath: string;
};

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dependsOn: string[];
  filePath: string;
  heading: string;
  headingLevel: number;
  sectionBody: string;
  order: number;
  sortIndex: number;
};

export type WorkspaceHandle = {
  path: string;
  kind: "shared" | "git_worktree";
  branchName: string | null;
};

export type OrchestratorState = {
  workflowPath: string;
  iteration: number;
  activeTaskId: string | null;
  commitsSincePush: number;
  lastCommittedTaskId: string | null;
  lastCommitSha: string | null;
  history: Array<{
    iteration: number;
    taskId: string | null;
    timestamp: string;
    status:
      | "started"
      | "continued"
      | "completed"
      | "blocked"
      | "idle"
      | "agent_error";
    note: string;
  }>;
};

export type OrchestratorCliOptions = {
  workflowFile: string;
  maxIterations?: number;
  once: boolean;
  dryRun: boolean;
  help: boolean;
};

export type OrchestratorRuntimeOptions = {
  repoRoot?: string;
  log?: (message: string) => void;
  error?: (message: string) => void;
  sleep?: (milliseconds: number) => void;
};

type RepoLockOwner = {
  pid: number | null;
  workflow: string;
  taskId: string;
  acquiredAt: string;
};

type FrontMatterValue = string | number | string[];

const DEFAULT_WORKFLOW: Omit<WorkflowConfig, "workflowBody" | "workflowPath"> =
  {
    name: "autonomous-development",
    taskSources: ["docs/tasks.md"],
    dependencySources: [],
    instructionFiles: [],
    decisionFile: "docs/decisions.md",
    progressFile: ".orchestrator/progress.md",
    stateFile: ".orchestrator/state.json",
    workspaceRoot: ".orchestrator/workspaces",
    workspaceMode: "git_worktree",
    agentCommand: "codex",
    agentArgs: ["exec"],
    maxIterations: 50,
    pollIntervalSeconds: 3,
    completionPhrase: "COMPLETE",
    requiredBranch: null,
    autoCommitOnDone: true,
    autoPushEveryCommits: 3,
  };

const STATUS_VALUES = new Set<TaskStatus>([
  "pending",
  "in-progress",
  "blocked",
  "review",
  "done",
]);

const DEFAULT_WORKFLOW_FILE = "WORKFLOW.md";
const REPO_LOCK_NAME = "repo.lock";
const LOCK_POLL_MS = 1000;
const STALE_LOCK_MS = 60_000;

function parseScalarValue(value: string): string | number {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseStringList(
  value: FrontMatterValue | undefined,
  fallback: string[],
): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    return [value];
  }

  return fallback;
}

export function runGit(args: string[], cwd: string) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function gitError(result: ReturnType<typeof runGit>, fallback: string): string {
  return result.stderr?.trim() || result.stdout?.trim() || fallback;
}

export function parseWorkflowFile(
  content: string,
  workflowPath = DEFAULT_WORKFLOW_FILE,
): WorkflowConfig {
  let frontMatter: Record<string, FrontMatterValue> = {};
  let workflowBody = content.trim();

  if (content.startsWith("---\n")) {
    const end = content.indexOf("\n---", 4);
    if (end === -1) {
      throw new Error(
        `Workflow file ${workflowPath} starts a front matter block but never closes it.`,
      );
    }

    const rawFrontMatter = content.slice(4, end).split("\n");
    workflowBody = content.slice(end + 4).trim();

    let currentKey: string | null = null;

    for (const rawLine of rawFrontMatter) {
      const line = rawLine.replace(/\r$/, "");
      if (!line.trim() || /^\s*#/.test(line)) {
        continue;
      }

      const listItemMatch = line.match(/^\s+-\s+(.*)$/);
      if (listItemMatch) {
        if (!currentKey) {
          throw new Error(
            `Found a list item before a key in ${workflowPath}: ${line}`,
          );
        }
        const current = frontMatter[currentKey];
        if (!Array.isArray(current)) {
          throw new Error(
            `Key ${currentKey} must be declared before adding list items in ${workflowPath}.`,
          );
        }
        current.push(String(parseScalarValue(listItemMatch[1])));
        continue;
      }

      const keyMatch = line.match(/^([A-Za-z0-9_]+):(?:\s+(.*))?$/);
      if (!keyMatch) {
        throw new Error(
          `Unsupported front matter syntax in ${workflowPath}: ${line}`,
        );
      }

      const [, key, rawValue] = keyMatch;
      currentKey = key;
      frontMatter[key] =
        rawValue === undefined || rawValue === ""
          ? []
          : parseScalarValue(rawValue);
    }
  }

  return {
    name:
      typeof frontMatter.name === "string"
        ? frontMatter.name
        : DEFAULT_WORKFLOW.name,
    taskSources: parseStringList(
      frontMatter.task_sources,
      DEFAULT_WORKFLOW.taskSources,
    ),
    dependencySources: parseStringList(
      frontMatter.dependency_sources,
      DEFAULT_WORKFLOW.dependencySources,
    ),
    instructionFiles: parseStringList(
      frontMatter.instruction_files,
      DEFAULT_WORKFLOW.instructionFiles,
    ),
    decisionFile:
      typeof frontMatter.decision_file === "string"
        ? frontMatter.decision_file
        : DEFAULT_WORKFLOW.decisionFile,
    progressFile:
      typeof frontMatter.progress_file === "string"
        ? frontMatter.progress_file
        : DEFAULT_WORKFLOW.progressFile,
    stateFile:
      typeof frontMatter.state_file === "string"
        ? frontMatter.state_file
        : DEFAULT_WORKFLOW.stateFile,
    workspaceRoot:
      typeof frontMatter.workspace_root === "string"
        ? frontMatter.workspace_root
        : DEFAULT_WORKFLOW.workspaceRoot,
    workspaceMode:
      frontMatter.workspace_mode === "shared" ||
      frontMatter.workspace_mode === "git_worktree"
        ? frontMatter.workspace_mode
        : DEFAULT_WORKFLOW.workspaceMode,
    agentCommand:
      typeof frontMatter.agent_command === "string"
        ? frontMatter.agent_command
        : DEFAULT_WORKFLOW.agentCommand,
    agentArgs: parseStringList(
      frontMatter.agent_args,
      DEFAULT_WORKFLOW.agentArgs,
    ),
    maxIterations:
      typeof frontMatter.max_iterations === "number"
        ? frontMatter.max_iterations
        : DEFAULT_WORKFLOW.maxIterations,
    pollIntervalSeconds:
      typeof frontMatter.poll_interval_seconds === "number"
        ? frontMatter.poll_interval_seconds
        : DEFAULT_WORKFLOW.pollIntervalSeconds,
    completionPhrase:
      typeof frontMatter.completion_phrase === "string"
        ? frontMatter.completion_phrase
        : DEFAULT_WORKFLOW.completionPhrase,
    requiredBranch:
      typeof frontMatter.required_branch === "string"
        ? frontMatter.required_branch
        : DEFAULT_WORKFLOW.requiredBranch,
    autoCommitOnDone:
      typeof frontMatter.auto_commit_on_done === "string"
        ? frontMatter.auto_commit_on_done.toLowerCase() === "true"
        : DEFAULT_WORKFLOW.autoCommitOnDone,
    autoPushEveryCommits:
      typeof frontMatter.auto_push_every_commits === "number"
        ? frontMatter.auto_push_every_commits
        : DEFAULT_WORKFLOW.autoPushEveryCommits,
    workflowBody,
    workflowPath,
  };
}

function normalizeStatus(rawStatus: string | null): TaskStatus {
  const normalized = (rawStatus ?? "pending")
    .trim()
    .toLowerCase() as TaskStatus;
  return STATUS_VALUES.has(normalized) ? normalized : "pending";
}

function normalizePriority(rawPriority: string | null): TaskPriority {
  if (!rawPriority) {
    return "unscored";
  }
  const normalized = rawPriority.trim().toUpperCase();
  return /^P\d+$/.test(normalized) ? (normalized as TaskPriority) : "unscored";
}

function parseDependsOn(rawDependsOn: string | null): string[] {
  if (!rawDependsOn) {
    return [];
  }
  const cleaned = rawDependsOn.replace(/`/g, "").trim();
  if (!cleaned || /^none$/i.test(cleaned)) {
    return [];
  }
  return cleaned
    .split(",")
    .map((dependency) => dependency.trim())
    .filter(Boolean);
}

export function parseTaskFile(content: string, filePath: string): Task[] {
  const lines = content.split(/\r?\n/);
  const tasks: Task[] = [];
  let currentHeading: {
    title: string;
    level: number;
    lineIndex: number;
  } | null = null;

  const flushTask = (endIndex: number) => {
    if (!currentHeading) {
      return;
    }

    const sectionLines = lines.slice(currentHeading.lineIndex + 1, endIndex);
    const sectionBody = sectionLines.join("\n").trim();
    const idMatch = sectionBody.match(/-\s+\*\*ID\*\*:\s+`([^`]+)`/);

    if (idMatch) {
      const statusMatch = sectionBody.match(
        /-\s+\*\*Status\*\*:\s+`?([^`\n]+)`?/,
      );
      const priorityMatch = sectionBody.match(
        /-\s+\*\*Priority\*\*:\s+`?([^`\n]+)`?/,
      );
      const dependsOnMatch = sectionBody.match(
        /-\s+\*\*Depends on\*\*:\s+([^\n]+)/,
      );

      tasks.push({
        id: idMatch[1].trim(),
        title: currentHeading.title,
        status: normalizeStatus(statusMatch?.[1] ?? null),
        priority: normalizePriority(priorityMatch?.[1] ?? null),
        dependsOn: parseDependsOn(dependsOnMatch?.[1] ?? null),
        filePath,
        heading: currentHeading.title,
        headingLevel: currentHeading.level,
        sectionBody,
        order: tasks.length,
        sortIndex: tasks.length,
      });
    }

    currentHeading = null;
  };

  lines.forEach((line, index) => {
    const headingMatch = line.match(/^(#{2,6})\s+(.+)$/);
    if (!headingMatch) {
      return;
    }

    flushTask(index);
    currentHeading = {
      title: headingMatch[2].trim(),
      level: headingMatch[1].length,
      lineIndex: index,
    };
  });

  flushTask(lines.length);
  return tasks;
}

export function resolvePath(
  repoRoot: string,
  maybeRelativePath: string,
): string {
  return isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : resolve(repoRoot, maybeRelativePath);
}

export function getRuntimeRoot(
  repoRoot: string,
  config: Pick<WorkflowConfig, "stateFile">,
): string {
  return dirname(resolvePath(repoRoot, config.stateFile));
}

export function loadTasks(repoRoot: string, taskSources: string[]): Task[] {
  let nextSortIndex = 0;

  return taskSources.flatMap((taskSource) => {
    const absolutePath = resolvePath(repoRoot, taskSource);
    const content = readFileSync(absolutePath, "utf8");
    return parseTaskFile(content, taskSource).map((task) => ({
      ...task,
      sortIndex: nextSortIndex++,
    }));
  });
}

export function mergeTaskUniverses(...taskLists: Task[][]): Task[] {
  const seen = new Set<string>();
  const merged: Task[] = [];

  for (const taskList of taskLists) {
    for (const task of taskList) {
      if (seen.has(task.id)) {
        continue;
      }
      seen.add(task.id);
      merged.push(task);
    }
  }

  return merged;
}

function priorityRank(priority: TaskPriority): number {
  return priority === "unscored" ? 999 : Number(priority.slice(1));
}

function isReady(task: Task, taskMap: Map<string, Task>): boolean {
  return task.dependsOn.every(
    (dependencyId) => taskMap.get(dependencyId)?.status === "done",
  );
}

export function selectNextTask(
  tasks: Task[],
  activeTaskId: string | null,
  dependencyUniverse: Task[] = tasks,
): Task | null {
  const taskMap = new Map(dependencyUniverse.map((task) => [task.id, task]));

  if (activeTaskId) {
    const activeTask = tasks.find((task) => task.id === activeTaskId);
    if (activeTask && activeTask.status !== "done") {
      return activeTask;
    }
  }

  const inProgressTask = tasks.find((task) => task.status === "in-progress");
  if (inProgressTask) {
    return inProgressTask;
  }

  const readyTasks = tasks.filter(
    (task) => task.status === "pending" && isReady(task, taskMap),
  );
  readyTasks.sort((left, right) => {
    const priorityDifference =
      priorityRank(left.priority) - priorityRank(right.priority);
    return priorityDifference !== 0
      ? priorityDifference
      : left.sortIndex - right.sortIndex;
  });

  return readyTasks[0] ?? null;
}

export function areAllTasksComplete(tasks: Task[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.status === "done");
}

export function loadWorkflow(
  repoRoot: string,
  workflowFile = DEFAULT_WORKFLOW_FILE,
): WorkflowConfig {
  const workflowPath = resolvePath(repoRoot, workflowFile);
  const content = readFileSync(workflowPath, "utf8");
  return parseWorkflowFile(
    content,
    relative(repoRoot, workflowPath) || workflowFile,
  );
}

export function ensureDirectory(path: string) {
  mkdirSync(path, { recursive: true });
}

export function loadState(
  repoRoot: string,
  config: WorkflowConfig,
): OrchestratorState {
  const statePath = resolvePath(repoRoot, config.stateFile);
  if (!existsSync(statePath)) {
    ensureDirectory(dirname(statePath));
    const initialState: OrchestratorState = {
      workflowPath: config.workflowPath,
      iteration: 0,
      activeTaskId: null,
      commitsSincePush: 0,
      lastCommittedTaskId: null,
      lastCommitSha: null,
      history: [],
    };
    writeFileSync(statePath, JSON.stringify(initialState, null, 2) + "\n");
    return initialState;
  }

  const state = JSON.parse(
    readFileSync(statePath, "utf8"),
  ) as OrchestratorState;
  return {
    workflowPath: state.workflowPath ?? config.workflowPath,
    iteration: state.iteration ?? 0,
    activeTaskId: state.activeTaskId ?? null,
    commitsSincePush: state.commitsSincePush ?? 0,
    lastCommittedTaskId: state.lastCommittedTaskId ?? null,
    lastCommitSha: state.lastCommitSha ?? null,
    history: Array.isArray(state.history) ? state.history : [],
  };
}

export function saveState(
  repoRoot: string,
  config: WorkflowConfig,
  state: OrchestratorState,
) {
  const statePath = resolvePath(repoRoot, config.stateFile);
  ensureDirectory(dirname(statePath));
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}

export function appendProgress(
  repoRoot: string,
  config: WorkflowConfig,
  lines: string[],
) {
  const progressPath = resolvePath(repoRoot, config.progressFile);
  ensureDirectory(dirname(progressPath));
  const existing = existsSync(progressPath)
    ? readFileSync(progressPath, "utf8")
    : `# ${config.name} Progress\n\n`;
  writeFileSync(progressPath, existing + lines.join("\n") + "\n");
}

export function getCurrentBranch(repoRoot: string): string | null {
  const result = runGit(["branch", "--show-current"], repoRoot);
  if (result.status !== 0) {
    return null;
  }

  const branch = result.stdout.trim();
  return branch.length > 0 ? branch : null;
}

function sanitizeBranchName(taskId: string): string {
  return `orchestrator-${taskId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
}

function sanitizePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

export function previewWorkspacePath(
  repoRoot: string,
  config: WorkflowConfig,
  task: Task,
): string {
  if (config.workspaceMode === "shared") {
    return repoRoot;
  }
  return join(
    resolvePath(repoRoot, config.workspaceRoot),
    sanitizePathSegment(task.id),
  );
}

export function ensureWorkspace(
  repoRoot: string,
  config: WorkflowConfig,
  task: Task,
): WorkspaceHandle {
  if (config.workspaceMode === "shared") {
    return {
      path: repoRoot,
      kind: "shared",
      branchName: getCurrentBranch(repoRoot),
    };
  }

  const workspacePath = previewWorkspacePath(repoRoot, config, task);
  const branchName = sanitizeBranchName(task.id);
  ensureDirectory(dirname(workspacePath));

  if (!existsSync(workspacePath)) {
    const baseRef = config.requiredBranch ?? "HEAD";
    const result = runGit(
      ["worktree", "add", "-B", branchName, workspacePath, baseRef],
      repoRoot,
    );
    if (result.status !== 0) {
      throw new Error(
        `Failed to create git worktree for ${task.id}: ${gitError(result, "git worktree add failed")}`,
      );
    }
  }

  return { path: workspacePath, kind: "git_worktree", branchName };
}

export function buildTaskPrompt(
  config: WorkflowConfig,
  task: Task,
  workspacePath: string,
): string {
  const instructionList =
    config.instructionFiles.length > 0
      ? config.instructionFiles.map((file) => `- ${file}`).join("\n")
      : "- None";
  const workspaceNote =
    workspacePath === process.cwd() ? "shared repo workspace" : workspacePath;
  const decisionDocTemplate = [
    `## YYYY-MM-DD - ${task.id} - Short decision title`,
    "- Context: What constraint, tradeoff, or problem forced the choice?",
    "- Decision: What you chose and why?",
    "- Impact: What changes, follow-ups, or consequences should future readers expect?",
  ].join("\n");

  return [
    `Workflow: ${config.name}`,
    `Task ID: ${task.id}`,
    `Task Title: ${task.title}`,
    `Task File: ${task.filePath}`,
    `Task Priority: ${task.priority}`,
    `Workspace: ${workspaceNote}`,
    "",
    config.workflowBody,
    "",
    "Instruction files to read first:",
    instructionList,
    "",
    "Decision doc:",
    `- Path: ${config.decisionFile}`,
    "- Update it when you make or revise a consequential implementation choice.",
    "- Keep entries short and durable so later runs can understand the reasoning quickly.",
    "- Use this format:",
    decisionDocTemplate,
    "",
    "Task section to implement:",
    `### ${task.heading}`,
    task.sectionBody,
    "",
    "Execution rules:",
    `1. Work only on the assigned task (${task.id}) and any strictly necessary dependencies inside the same repo.`,
    `2. Update the task status in ${task.filePath} to \`in-progress\` or \`done\` as appropriate.`,
    `3. Update ${config.decisionFile} if you make or revise a consequential implementation decision.`,
    "4. Do not edit the orchestrator progress/state files directly; the orchestrator records runtime progress for you.",
    "5. Run the most relevant tests or validation commands for the files you changed when feasible.",
    `6. If the task is fully complete, say \`TASK_DONE ${task.id}\` in the final message.`,
    `7. If the task is blocked, say \`TASK_BLOCKED ${task.id}: <reason>\` in the final message.`,
    `8. If all tracked tasks are complete, say \`${config.completionPhrase}\` in the final message.`,
  ].join("\n");
}

export type AgentRunResult = {
  exitCode: number;
  lastMessage: string;
  commandLine: string;
};

export type RepoCommitResult = {
  committed: boolean;
  commitSha: string | null;
  error: string | null;
};

export type RepoPushResult = {
  pushed: boolean;
  error: string | null;
};

export type CherryPickResult = {
  applied: boolean;
  commitCount: number;
  lastCommitSha: string | null;
  error: string | null;
};

export function getHeadCommit(repoPath: string): string | null {
  const result = runGit(["rev-parse", "--short", "HEAD"], repoPath);
  if (result.status !== 0) {
    return null;
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : null;
}

export function listUniqueCommits(repoPath: string, baseRef: string): string[] {
  const cherryResult = runGit(["cherry", baseRef, "HEAD"], repoPath);
  if (cherryResult.status !== 0) {
    throw new Error(
      `Failed to inspect task branch commit equivalence: ${gitError(cherryResult, "git cherry failed")}`,
    );
  }

  const unapplied = new Set(
    cherryResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("+ "))
      .map((line) => line.slice(2).trim()),
  );

  if (unapplied.size === 0) {
    return [];
  }

  const revListResult = runGit(
    ["rev-list", "--reverse", `${baseRef}..HEAD`],
    repoPath,
  );
  if (revListResult.status !== 0) {
    throw new Error(
      `Failed to list task branch commits: ${gitError(revListResult, "git rev-list failed")}`,
    );
  }

  return revListResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((commit) => unapplied.has(commit));
}

export function commitPendingChanges(
  repoPath: string,
  message: string,
): RepoCommitResult {
  const addResult = runGit(["add", "-A"], repoPath);
  if (addResult.status !== 0) {
    return {
      committed: false,
      commitSha: null,
      error: gitError(addResult, "git add failed"),
    };
  }

  const statusResult = runGit(["status", "--porcelain"], repoPath);
  if (statusResult.status !== 0) {
    return {
      committed: false,
      commitSha: null,
      error: gitError(statusResult, "git status failed"),
    };
  }

  if (!statusResult.stdout.trim()) {
    return { committed: false, commitSha: null, error: null };
  }

  const commitResult = runGit(["commit", "-m", message], repoPath);
  if (commitResult.status !== 0) {
    return {
      committed: false,
      commitSha: null,
      error: gitError(commitResult, "git commit failed"),
    };
  }

  return {
    committed: true,
    commitSha: getHeadCommit(repoPath),
    error: null,
  };
}

export function cherryPickCommits(
  repoRoot: string,
  commits: string[],
): CherryPickResult {
  if (commits.length === 0) {
    return { applied: false, commitCount: 0, lastCommitSha: null, error: null };
  }

  let appliedCount = 0;
  let lastCommitSha: string | null = null;

  for (const commit of commits) {
    const cherryPickResult = runGit(["cherry-pick", "-x", commit], repoRoot);
    if (cherryPickResult.status !== 0) {
      runGit(["cherry-pick", "--abort"], repoRoot);
      return {
        applied: appliedCount > 0,
        commitCount: appliedCount,
        lastCommitSha,
        error: gitError(
          cherryPickResult,
          `git cherry-pick failed for ${commit}`,
        ),
      };
    }

    appliedCount += 1;
    lastCommitSha = getHeadCommit(repoRoot);
  }

  return {
    applied: appliedCount > 0,
    commitCount: appliedCount,
    lastCommitSha,
    error: null,
  };
}

export function pushBranch(repoRoot: string, branch: string): RepoPushResult {
  const pushResult = runGit(["push", "origin", branch], repoRoot);
  if (pushResult.status !== 0) {
    return {
      pushed: false,
      error: gitError(pushResult, `git push failed for ${branch}`),
    };
  }

  return { pushed: true, error: null };
}

export function runAgentForTask(
  repoRoot: string,
  config: WorkflowConfig,
  task: Task,
  workspacePath: string,
  prompt: string,
): AgentRunResult {
  const runtimeRoot = getRuntimeRoot(repoRoot, config);
  ensureDirectory(runtimeRoot);
  const lastMessagePath = join(
    runtimeRoot,
    `${sanitizePathSegment(task.id)}-last-message.txt`,
  );
  const args = [
    ...config.agentArgs,
    "-C",
    workspacePath,
    "-o",
    lastMessagePath,
    "-",
  ];

  const child = spawnSync(config.agentCommand, args, {
    cwd: repoRoot,
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf8",
    env: {
      ...process.env,
      ORCHESTRATOR_TASK_ID: task.id,
      ORCHESTRATOR_TASK_FILE: task.filePath,
      ORCHESTRATOR_WORKFLOW: config.name,
    },
  });

  return {
    exitCode: child.status ?? 1,
    lastMessage: existsSync(lastMessagePath)
      ? readFileSync(lastMessagePath, "utf8")
      : "",
    commandLine: [config.agentCommand, ...args].join(" "),
  };
}

export function formatHistoryNote(
  taskId: string | null,
  status: OrchestratorState["history"][number]["status"],
  note: string,
) {
  return `- ${new Date().toISOString()} | ${taskId ?? "none"} | ${status} | ${note}`;
}

function parseIterationCount(rawValue: string): number {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("--max-iterations must be a non-negative integer.");
  }
  return value;
}

function readCliValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function formatOrchestratorCliUsage(
  scriptPath = "scripts/orchestrator.ts",
): string {
  return [
    `Usage: bun run ${scriptPath} [options]`,
    "",
    "Options:",
    `  --workflow <path>        Workflow file to load (default: ${DEFAULT_WORKFLOW_FILE})`,
    "  --max-iterations <n>     Override workflow max_iterations",
    "  --once                   Run a single loop iteration",
    "  --dry-run                Select a task and print a prompt preview without running the agent",
    "  --help                   Show this help text",
  ].join("\n");
}

export function parseOrchestratorCliArgs(
  argv: string[],
): OrchestratorCliOptions {
  const options: OrchestratorCliOptions = {
    workflowFile: DEFAULT_WORKFLOW_FILE,
    once: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg.startsWith("--workflow=")) {
      const workflowFile = arg.slice("--workflow=".length);
      if (!workflowFile) {
        throw new Error("--workflow requires a value.");
      }
      options.workflowFile = workflowFile;
      continue;
    }

    if (arg === "--workflow") {
      options.workflowFile = readCliValue(argv, index, "--workflow");
      index += 1;
      continue;
    }

    if (arg.startsWith("--max-iterations=")) {
      const rawValue = arg.slice("--max-iterations=".length);
      if (!rawValue) {
        throw new Error("--max-iterations requires a value.");
      }
      options.maxIterations = parseIterationCount(rawValue);
      continue;
    }

    if (arg === "--max-iterations") {
      options.maxIterations = parseIterationCount(
        readCliValue(argv, index, "--max-iterations"),
      );
      index += 1;
      continue;
    }

    if (arg === "--once") {
      options.once = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function getRepoLockPath(repoRoot: string, workflow: WorkflowConfig): string {
  return resolve(getRuntimeRoot(repoRoot, workflow), REPO_LOCK_NAME);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockOwner(lockPath: string): RepoLockOwner | null {
  const ownerPath = join(lockPath, "owner.json");
  if (!existsSync(ownerPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(ownerPath, "utf8")) as RepoLockOwner;
  } catch {
    return null;
  }
}

function tryRemoveStaleLock(lockPath: string): boolean {
  if (!existsSync(lockPath)) {
    return false;
  }

  const owner = readLockOwner(lockPath);
  if (owner?.pid && isProcessAlive(owner.pid)) {
    return false;
  }

  let staleByAge = false;
  try {
    const stats = statSync(lockPath);
    staleByAge = Date.now() - stats.mtimeMs > STALE_LOCK_MS;
  } catch {
    staleByAge = true;
  }

  if (!owner || staleByAge) {
    rmSync(lockPath, { recursive: true, force: true });
    return true;
  }

  return false;
}

function acquireRepoLock(
  repoRoot: string,
  workflow: WorkflowConfig,
  taskId: string,
): string {
  const runtimeRoot = getRuntimeRoot(repoRoot, workflow);
  const lockPath = getRepoLockPath(repoRoot, workflow);
  mkdirSync(runtimeRoot, { recursive: true });

  while (true) {
    try {
      mkdirSync(lockPath);
      const owner: RepoLockOwner = {
        pid: process.pid,
        workflow: workflow.name,
        taskId,
        acquiredAt: new Date().toISOString(),
      };
      writeFileSync(
        join(lockPath, "owner.json"),
        JSON.stringify(owner, null, 2),
      );
      return lockPath;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw error;
      }
      if (!tryRemoveStaleLock(lockPath)) {
        Bun.sleepSync(LOCK_POLL_MS);
      }
    }
  }
}

function releaseRepoLock(lockPath: string) {
  rmSync(lockPath, { recursive: true, force: true });
}

function loadActionableTasks(repoRoot: string, workflowPath: string) {
  const workflow = loadWorkflow(repoRoot, workflowPath);
  const actionable = loadTasks(repoRoot, workflow.taskSources);
  const dependencies = loadTasks(repoRoot, workflow.dependencySources);
  const taskUniverse = mergeTaskUniverses(actionable, dependencies);
  return { workflow, actionable, taskUniverse };
}

function findTaskById(tasks: Task[], taskId: string): Task | null {
  return tasks.find((task) => task.id === taskId) ?? null;
}

function didTaskComplete(task: Task, lastMessage: string): boolean {
  return task.status === "done" || lastMessage.includes(`TASK_DONE ${task.id}`);
}

function didTaskBlock(task: Task, lastMessage: string): boolean {
  return (
    task.status === "blocked" || lastMessage.includes(`TASK_BLOCKED ${task.id}`)
  );
}

function extractBlockedReason(taskId: string, lastMessage: string): string {
  return (
    lastMessage
      .split("\n")
      .find((line) => line.includes(`TASK_BLOCKED ${taskId}`)) ??
    `${taskId} blocked.`
  );
}

function maybePushBranch(
  repoRoot: string,
  branch: string,
  commitsSincePush: number,
  force = false,
) {
  if (!force && commitsSincePush <= 0) {
    return { pushed: false, error: null };
  }
  return pushBranch(repoRoot, branch);
}

function isAutoPushEnabled(
  workflow: Pick<WorkflowConfig, "autoPushEveryCommits">,
) {
  return workflow.autoPushEveryCommits > 0;
}

function integrateTerminalTask(params: {
  repoRoot: string;
  workflow: WorkflowConfig;
  task: Task;
  terminalStatus: "completed" | "blocked";
  rootActionableTasks: Task[];
  state: OrchestratorState;
}): {
  historyNote: string;
  refreshedActionableTasks: Task[];
} {
  const {
    repoRoot,
    workflow,
    task,
    terminalStatus,
    rootActionableTasks,
    state,
  } = params;
  const integrationBranch =
    workflow.requiredBranch ?? getCurrentBranch(repoRoot);
  if (!integrationBranch) {
    throw new Error(
      "Could not determine the integration branch for task integration.",
    );
  }

  const workspace = ensureWorkspace(repoRoot, workflow, task);
  const commitVerb = terminalStatus === "completed" ? "complete" : "block";
  const commitMessage = `orchestrator: ${commitVerb} ${task.id} ${task.title}`;
  const commitResult = commitPendingChanges(workspace.path, commitMessage);
  if (commitResult.error) {
    throw new Error(
      `${task.id} ${commitVerb} auto-commit failed in task branch: ${commitResult.error}`,
    );
  }

  const currentWorkspaceBranch = getCurrentBranch(workspace.path);
  if (
    workspace.kind === "shared" &&
    currentWorkspaceBranch === integrationBranch
  ) {
    const refreshedActionableTasks = loadTasks(repoRoot, workflow.taskSources);
    const refreshedTask = findTaskById(refreshedActionableTasks, task.id);
    const terminalLabel =
      terminalStatus === "completed" ? "completed" : "blocked";

    if (terminalStatus === "completed" && refreshedTask?.status !== "done") {
      throw new Error(
        `${task.id} committed directly on ${integrationBranch} but root task status is not done.`,
      );
    }
    if (terminalStatus === "blocked" && refreshedTask?.status !== "blocked") {
      throw new Error(
        `${task.id} committed directly on ${integrationBranch} but root task status is not blocked.`,
      );
    }

    let historyNote = commitResult.committed
      ? `${task.id} ${terminalLabel} and committed directly on ${integrationBranch}${
          commitResult.commitSha ? ` as ${commitResult.commitSha}` : ""
        }.`
      : `${task.id} already reflected on ${integrationBranch}; no direct commit needed.`;

    if (commitResult.committed) {
      state.commitsSincePush += 1;
      state.lastCommittedTaskId = task.id;
      state.lastCommitSha = commitResult.commitSha;
    }

    const shouldPush =
      isAutoPushEnabled(workflow) &&
      state.commitsSincePush > 0 &&
      (state.commitsSincePush >= workflow.autoPushEveryCommits ||
        areAllTasksComplete(refreshedActionableTasks));

    if (shouldPush) {
      const pushResult = maybePushBranch(
        repoRoot,
        integrationBranch,
        state.commitsSincePush,
        true,
      );
      if (pushResult.error) {
        throw new Error(`${historyNote} Auto-push failed: ${pushResult.error}`);
      }
      state.commitsSincePush = 0;
      historyNote = `${historyNote} Pushed ${integrationBranch}.`;
    }

    return { historyNote, refreshedActionableTasks };
  }

  const lockPath = acquireRepoLock(repoRoot, workflow, task.id);
  try {
    const uniqueCommits = listUniqueCommits(workspace.path, integrationBranch);
    if (uniqueCommits.length === 0) {
      const rootTask = findTaskById(rootActionableTasks, task.id);
      const rootAlreadyMatches =
        (terminalStatus === "completed" && rootTask?.status === "done") ||
        (terminalStatus === "blocked" && rootTask?.status === "blocked");
      if (!rootAlreadyMatches) {
        throw new Error(
          `${task.id} reached ${terminalStatus} but produced no new task-branch commits to integrate.`,
        );
      }
      return {
        historyNote: `${task.id} already reflected on ${integrationBranch}; no new commits to integrate.`,
        refreshedActionableTasks: rootActionableTasks,
      };
    }

    const cherryPickResult = cherryPickCommits(repoRoot, uniqueCommits);
    if (cherryPickResult.error) {
      throw new Error(
        `${task.id} integration failed: ${cherryPickResult.error}`,
      );
    }

    state.commitsSincePush += cherryPickResult.commitCount;
    state.lastCommittedTaskId = task.id;
    state.lastCommitSha = cherryPickResult.lastCommitSha;

    const refreshedActionableTasks = loadTasks(repoRoot, workflow.taskSources);
    const refreshedTask = findTaskById(refreshedActionableTasks, task.id);
    const terminalLabel =
      terminalStatus === "completed" ? "completed" : "blocked";
    let historyNote = `${task.id} ${terminalLabel} and integrated ${cherryPickResult.commitCount} commit${
      cherryPickResult.commitCount === 1 ? "" : "s"
    }${cherryPickResult.lastCommitSha ? ` as ${cherryPickResult.lastCommitSha}` : ""}.`;

    const shouldPush =
      isAutoPushEnabled(workflow) &&
      (state.commitsSincePush >= workflow.autoPushEveryCommits ||
        areAllTasksComplete(refreshedActionableTasks));

    if (shouldPush) {
      const pushResult = maybePushBranch(
        repoRoot,
        integrationBranch,
        state.commitsSincePush,
        true,
      );
      if (pushResult.error) {
        throw new Error(`${historyNote} Auto-push failed: ${pushResult.error}`);
      }
      state.commitsSincePush = 0;
      historyNote = `${historyNote} Pushed ${integrationBranch}.`;
    }

    if (terminalStatus === "completed" && refreshedTask?.status !== "done") {
      throw new Error(
        `${task.id} integrated successfully but root task status is not done.`,
      );
    }
    if (terminalStatus === "blocked" && refreshedTask?.status !== "blocked") {
      throw new Error(
        `${task.id} integrated successfully but root task status is not blocked.`,
      );
    }

    return { historyNote, refreshedActionableTasks };
  } finally {
    releaseRepoLock(lockPath);
  }
}

export function runOrchestratorLoop(
  options: Pick<
    OrchestratorCliOptions,
    "workflowFile" | "maxIterations" | "once" | "dryRun"
  >,
  runtime: OrchestratorRuntimeOptions = {},
): number {
  const repoRoot = runtime.repoRoot ?? process.cwd();
  const log = runtime.log ?? ((message: string) => console.log(message));
  const error = runtime.error ?? ((message: string) => console.error(message));
  const sleep =
    runtime.sleep ?? ((milliseconds: number) => Bun.sleepSync(milliseconds));

  const workflow = loadWorkflow(repoRoot, options.workflowFile);
  const requiredBranch = workflow.requiredBranch;
  const currentBranch = getCurrentBranch(repoRoot);

  if (requiredBranch && currentBranch !== requiredBranch) {
    error(
      `Workflow ${workflow.name} requires branch ${requiredBranch}, but current branch is ${currentBranch ?? "(detached)"}.`,
    );
    return 1;
  }

  const state = loadState(repoRoot, workflow);
  const maxIterations = options.maxIterations ?? workflow.maxIterations;

  for (let loop = 0; loop < maxIterations; loop += 1) {
    const { actionable, taskUniverse } = loadActionableTasks(
      repoRoot,
      options.workflowFile,
    );
    const task = selectNextTask(actionable, state.activeTaskId, taskUniverse);

    if (!task) {
      state.activeTaskId = null;
      appendProgress(repoRoot, workflow, [
        formatHistoryNote(null, "idle", "No ready tasks."),
      ]);
      saveState(repoRoot, workflow, state);

      if (areAllTasksComplete(actionable)) {
        const integrationBranch =
          workflow.requiredBranch ?? getCurrentBranch(repoRoot);
        if (
          integrationBranch &&
          workflow.autoCommitOnDone &&
          isAutoPushEnabled(workflow) &&
          state.commitsSincePush > 0
        ) {
          const pushResult = maybePushBranch(
            repoRoot,
            integrationBranch,
            state.commitsSincePush,
            true,
          );
          if (pushResult.error) {
            error(`Final auto-push failed: ${pushResult.error}`);
            return 1;
          }
          state.commitsSincePush = 0;
          saveState(repoRoot, workflow, state);
        }
        log(workflow.completionPhrase);
        return 0;
      }

      if (options.once) {
        return 0;
      }

      const waitMs = workflow.pollIntervalSeconds * 1000;
      if (waitMs > 0) {
        sleep(waitMs);
      }
      continue;
    }

    const workspacePreview = previewWorkspacePath(repoRoot, workflow, task);
    const prompt = buildTaskPrompt(workflow, task, workspacePreview);

    state.iteration += 1;
    state.activeTaskId = task.id;
    appendProgress(repoRoot, workflow, [
      formatHistoryNote(
        task.id,
        task.id === state.lastCommittedTaskId ? "continued" : "started",
        `Selected ${task.id} in ${workspacePreview === repoRoot ? "." : workspacePreview}.`,
      ),
    ]);
    saveState(repoRoot, workflow, state);

    log(`\n=== Iteration ${state.iteration}: ${task.id} ${task.title} ===`);
    log(`Workspace: ${workspacePreview}`);

    if (options.dryRun) {
      log("Dry run selected task summary:");
      log(`- Task: ${task.id}`);
      log(`- Status: ${task.status}`);
      log(`- Priority: ${task.priority}`);
      log(`- Depends on: ${task.dependsOn.join(", ") || "None"}`);
      log(
        `- Prompt preview: ${prompt.slice(0, 400)}${prompt.length > 400 ? "..." : ""}`,
      );
      return 0;
    }

    const workspace = ensureWorkspace(repoRoot, workflow, task);
    const runResult = runAgentForTask(
      repoRoot,
      workflow,
      task,
      workspace.path,
      buildTaskPrompt(workflow, task, workspace.path),
    );

    let refreshedActionableTasks = actionable;
    let historyStatus: "completed" | "blocked" | "agent_error" | "continued" =
      "continued";
    let historyNote = `Agent exited with code ${runResult.exitCode}.`;
    let stopAfterIteration = false;

    try {
      const workspaceActionableTasks = loadTasks(
        workspace.path,
        workflow.taskSources,
      );
      const workspaceTask =
        findTaskById(workspaceActionableTasks, task.id) ?? task;

      if (runResult.exitCode !== 0) {
        historyStatus = "agent_error";
        historyNote = `Agent command failed: ${runResult.commandLine}`;
        state.activeTaskId = null;
        stopAfterIteration = true;
      } else if (didTaskComplete(workspaceTask, runResult.lastMessage)) {
        historyStatus = "completed";
        state.activeTaskId = null;
        const integrationResult = integrateTerminalTask({
          repoRoot,
          workflow,
          task: workspaceTask,
          terminalStatus: "completed",
          rootActionableTasks: actionable,
          state,
        });
        refreshedActionableTasks = integrationResult.refreshedActionableTasks;
        historyNote = integrationResult.historyNote;
      } else if (didTaskBlock(workspaceTask, runResult.lastMessage)) {
        historyStatus = "blocked";
        state.activeTaskId = null;
        const integrationResult = integrateTerminalTask({
          repoRoot,
          workflow,
          task: workspaceTask,
          terminalStatus: "blocked",
          rootActionableTasks: actionable,
          state,
        });
        refreshedActionableTasks = integrationResult.refreshedActionableTasks;
        historyNote = extractBlockedReason(task.id, runResult.lastMessage);
        if (integrationResult.historyNote) {
          historyNote = `${historyNote} ${integrationResult.historyNote}`;
        }
      } else {
        historyStatus = "continued";
        historyNote = `${task.id} remains ${workspaceTask.status}.`;
        state.activeTaskId = task.id;
      }

      appendProgress(repoRoot, workflow, [
        formatHistoryNote(task.id, historyStatus, historyNote),
      ]);
      state.history.push({
        iteration: state.iteration,
        taskId: task.id,
        timestamp: new Date().toISOString(),
        status: historyStatus,
        note: historyNote,
      });
      saveState(repoRoot, workflow, state);
    } catch (caughtError) {
      historyStatus = "agent_error";
      historyNote =
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError);
      state.activeTaskId = null;
      appendProgress(repoRoot, workflow, [
        formatHistoryNote(task.id, historyStatus, historyNote),
      ]);
      state.history.push({
        iteration: state.iteration,
        taskId: task.id,
        timestamp: new Date().toISOString(),
        status: historyStatus,
        note: historyNote,
      });
      saveState(repoRoot, workflow, state);
      stopAfterIteration = true;
    }

    if (stopAfterIteration) {
      error(historyNote);
      return 1;
    }

    if (
      runResult.lastMessage.includes(workflow.completionPhrase) ||
      areAllTasksComplete(refreshedActionableTasks)
    ) {
      const integrationBranch =
        workflow.requiredBranch ?? getCurrentBranch(repoRoot);
      if (
        integrationBranch &&
        workflow.autoCommitOnDone &&
        isAutoPushEnabled(workflow) &&
        state.commitsSincePush > 0
      ) {
        const pushResult = maybePushBranch(
          repoRoot,
          integrationBranch,
          state.commitsSincePush,
          true,
        );
        if (pushResult.error) {
          error(`Final auto-push failed: ${pushResult.error}`);
          return 1;
        }
        state.commitsSincePush = 0;
        saveState(repoRoot, workflow, state);
      }
      log(workflow.completionPhrase);
      return 0;
    }

    if (options.once) {
      return 0;
    }

    const waitMs = workflow.pollIntervalSeconds * 1000;
    if (waitMs > 0) {
      sleep(waitMs);
    }
  }

  log(`Reached max iterations without seeing ${workflow.completionPhrase}.`);
  return 0;
}

export function runOrchestratorCli(
  argv: string[],
  runtime: OrchestratorRuntimeOptions = {},
): number {
  const log = runtime.log ?? ((message: string) => console.log(message));
  const error = runtime.error ?? ((message: string) => console.error(message));

  let options: OrchestratorCliOptions;
  try {
    options = parseOrchestratorCliArgs(argv);
  } catch (caughtError) {
    error(
      caughtError instanceof Error ? caughtError.message : String(caughtError),
    );
    error(formatOrchestratorCliUsage());
    return 1;
  }

  if (options.help) {
    log(formatOrchestratorCliUsage());
    return 0;
  }

  try {
    return runOrchestratorLoop(options, runtime);
  } catch (caughtError) {
    error(
      caughtError instanceof Error ? caughtError.message : String(caughtError),
    );
    return 1;
  }
}
