import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

export type TaskStatus =
  | "pending"
  | "in-progress"
  | "blocked"
  | "review"
  | "done";

export type TaskPriority = `P${number}` | "unscored";

export type TerminalCommitBehavior = "per_task";

export type TaskFailureKind = "agent" | "runtime" | "integration";

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
  terminalCommitBehavior: TerminalCommitBehavior;
  autoPushEveryCommits: number;
  reviewEveryTasks: number;
  taskFailureRetryLimit: number;
  taskFailureBackoffSeconds: number;
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

export type OrchestratorHistoryStatus =
  | "started"
  | "continued"
  | "completed"
  | "blocked"
  | "idle"
  | "retry_scheduled"
  | "retry_exhausted"
  | "review_started"
  | "review_completed"
  | "review_error";

export type OrchestratorTaskFailureRecord = {
  consecutiveFailures: number;
  lastFailureAt: string;
  lastFailureKind: TaskFailureKind;
  lastFailureNote: string;
  lastBackoffSeconds: number;
  nextRetryAt: string | null;
  staleWorkspace: boolean;
  staleWorkspaceReason: string | null;
};

export type OrchestratorReviewRecord = {
  id: string;
  iteration: number;
  timestamp: string;
  reviewedTaskIds: string[];
  remediationTaskIds: string[];
  lastMessageFile: string;
  commitSha: string | null;
  note: string;
};

export type OrchestratorState = {
  workflowPath: string;
  iteration: number;
  activeTaskId: string | null;
  commitsSincePush: number;
  lastCommittedTaskId: string | null;
  lastCommitSha: string | null;
  lastReviewedCompletionCount: number;
  reviews: OrchestratorReviewRecord[];
  taskFailures: Record<string, OrchestratorTaskFailureRecord>;
  history: Array<{
    iteration: number;
    taskId: string | null;
    timestamp: string;
    status: OrchestratorHistoryStatus;
    note: string;
  }>;
};

export type OrchestratorRuntimePhase =
  | "starting"
  | "running_task"
  | "integrating_task"
  | "running_review"
  | "integrating_review"
  | "idle"
  | "sleeping"
  | "completed"
  | "error";

export type OrchestratorRuntimeRetryStatus = {
  limit: number;
  baseBackoffSeconds: number;
  activeFailureCount: number;
  activeTaskIds: string[];
  waitingTaskIds: string[];
  exhaustedTaskIds: string[];
  nextRetryAt: string | null;
  taskFailures: Record<string, OrchestratorTaskFailureRecord>;
};

export type OrchestratorHeartbeat = {
  workflowName: string;
  workflowPath: string;
  pid: number;
  phase: OrchestratorRuntimePhase;
  activeTaskId: string | null;
  iteration: number;
  heartbeatAt: string;
  lastNote: string | null;
  lastError: string | null;
};

export type OrchestratorRuntimeStatus = OrchestratorHeartbeat & {
  waitingUntil: string | null;
  lastHistoryStatus: OrchestratorHistoryStatus | null;
  retry: OrchestratorRuntimeRetryStatus;
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

export type OrchestratorSupervisorCliCommand =
  | "run"
  | "start"
  | "stop"
  | "status";

export type OrchestratorSupervisorCliOptions = {
  command: OrchestratorSupervisorCliCommand;
  workflowFile: string;
  stallSeconds: number;
  checkIntervalSeconds: number;
  restartDelaySeconds: number;
  help: boolean;
};

export type OrchestratorSupervisorRuntimeOptions = {
  repoRoot?: string;
  log?: (message: string) => void;
  error?: (message: string) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  scriptPath?: string;
};

export type OrchestratorLaunchdCliCommand = "print" | "install" | "uninstall";

export type OrchestratorLaunchdCliOptions = {
  command: OrchestratorLaunchdCliCommand;
  workflowFile: string;
  label: string | null;
  launchAgentDir: string | null;
  path: string | null;
  home: string | null;
  stallSeconds: number;
  checkIntervalSeconds: number;
  restartDelaySeconds: number;
  help: boolean;
};

type LaunchctlCommandResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error | null;
};

export type OrchestratorLaunchdRuntimeOptions = {
  repoRoot?: string;
  log?: (message: string) => void;
  error?: (message: string) => void;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  uid?: number | null;
  scriptPath?: string;
  runLaunchctl?: (args: string[]) => LaunchctlCommandResult;
};

export type OrchestratorSupervisorState =
  | "starting"
  | "running"
  | "restarting"
  | "stopping"
  | "completed"
  | "stopped"
  | "error";

export type OrchestratorSupervisorWorkerSource =
  | "status"
  | "heartbeat"
  | "missing"
  | "invalid";

export type OrchestratorSupervisorWorkerSnapshot = {
  pid: number | null;
  source: OrchestratorSupervisorWorkerSource;
  phase: OrchestratorRuntimePhase | null;
  activeTaskId: string | null;
  heartbeatAt: string | null;
  waitingUntil: string | null;
  lastNote: string | null;
  lastError: string | null;
};

export type OrchestratorSupervisorStatus = {
  workflowName: string;
  workflowPath: string;
  pid: number;
  state: OrchestratorSupervisorState;
  startedAt: string;
  updatedAt: string;
  stallSeconds: number;
  checkIntervalSeconds: number;
  restartDelaySeconds: number;
  restartCount: number;
  lastRestartAt: string | null;
  lastRestartReason: string | null;
  lastWorkerExitCode: number | null;
  lastWorkerSignal: string | null;
  worker: {
    pid: number | null;
    startedAt: string | null;
    source: OrchestratorSupervisorWorkerSource;
    phase: OrchestratorRuntimePhase | null;
    activeTaskId: string | null;
    heartbeatAt: string | null;
    waitingUntil: string | null;
    lastNote: string | null;
    lastError: string | null;
  };
};

type RuntimeLockOwner = {
  pid: number | null;
  workflow: string;
  workflowPath?: string;
  purpose?: "repo" | "worker" | "supervisor";
  detail?: string | null;
  taskId?: string;
  acquiredAt: string;
};

type FrontMatterValue = string | number | string[];

type RuntimeHealthUpdate = {
  phase: OrchestratorRuntimePhase;
  activeTaskId?: string | null;
  lastNote?: string | null;
  lastError?: string | null;
  waitingUntil?: string | null;
  now?: Date;
};

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
    terminalCommitBehavior: "per_task",
    autoPushEveryCommits: 3,
    reviewEveryTasks: 3,
    taskFailureRetryLimit: 3,
    taskFailureBackoffSeconds: 30,
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
const WORKER_LOCK_PREFIX = "worker";
const SUPERVISOR_LOCK_PREFIX = "supervisor";
const LOCK_POLL_MS = 1000;
const STALE_LOCK_MS = 60_000;
const DEFAULT_SUPERVISOR_STALL_SECONDS = 1800;
const DEFAULT_SUPERVISOR_CHECK_INTERVAL_SECONDS = 5;
const DEFAULT_SUPERVISOR_RESTART_DELAY_SECONDS = 3;
const DEFAULT_LAUNCH_AGENT_DIR = "Library/LaunchAgents";
const DEFAULT_LAUNCHD_PATH =
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const PROCESS_EXIT_POLL_MS = 100;

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

function parseTerminalCommitBehavior(
  value: FrontMatterValue | undefined,
  workflowPath: string,
): TerminalCommitBehavior {
  if (value === undefined) {
    return DEFAULT_WORKFLOW.terminalCommitBehavior;
  }

  if (value === "per_task") {
    return "per_task";
  }

  throw new Error(
    `Unsupported terminal_commit_behavior in ${workflowPath}: ${String(value)}. Use "per_task".`,
  );
}

function parseReviewEveryTasks(
  value: FrontMatterValue | undefined,
  workflowPath: string,
): number {
  if (value === undefined) {
    return DEFAULT_WORKFLOW.reviewEveryTasks;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(
    `Unsupported review_every_tasks in ${workflowPath}: ${String(value)}. Use a non-negative integer.`,
  );
}

function parseTaskFailureRetryLimit(
  value: FrontMatterValue | undefined,
  workflowPath: string,
): number {
  if (value === undefined) {
    return DEFAULT_WORKFLOW.taskFailureRetryLimit;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(
    `Unsupported task_failure_retry_limit in ${workflowPath}: ${String(value)}. Use a non-negative integer.`,
  );
}

function parseTaskFailureBackoffSeconds(
  value: FrontMatterValue | undefined,
  workflowPath: string,
): number {
  if (value === undefined) {
    return DEFAULT_WORKFLOW.taskFailureBackoffSeconds;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(
    `Unsupported task_failure_backoff_seconds in ${workflowPath}: ${String(value)}. Use a non-negative integer.`,
  );
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
    terminalCommitBehavior: parseTerminalCommitBehavior(
      frontMatter.terminal_commit_behavior,
      workflowPath,
    ),
    autoPushEveryCommits:
      typeof frontMatter.auto_push_every_commits === "number"
        ? frontMatter.auto_push_every_commits
        : DEFAULT_WORKFLOW.autoPushEveryCommits,
    reviewEveryTasks: parseReviewEveryTasks(
      frontMatter.review_every_tasks,
      workflowPath,
    ),
    taskFailureRetryLimit: parseTaskFailureRetryLimit(
      frontMatter.task_failure_retry_limit,
      workflowPath,
    ),
    taskFailureBackoffSeconds: parseTaskFailureBackoffSeconds(
      frontMatter.task_failure_backoff_seconds,
      workflowPath,
    ),
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

function getRuntimeArtifactPath(
  repoRoot: string,
  config: Pick<WorkflowConfig, "stateFile">,
  suffix: string,
) {
  const statePath = resolvePath(repoRoot, config.stateFile);
  const stateFileName = basename(statePath) || "state.json";
  const artifactFileName = stateFileName.endsWith("state.json")
    ? stateFileName.replace(/state\.json$/, suffix)
    : `${stateFileName}.${suffix}`;
  return join(dirname(statePath), artifactFileName);
}

export function getRuntimeStatusPath(
  repoRoot: string,
  config: Pick<WorkflowConfig, "stateFile">,
) {
  return getRuntimeArtifactPath(repoRoot, config, "status.json");
}

export function getRuntimeHeartbeatPath(
  repoRoot: string,
  config: Pick<WorkflowConfig, "stateFile">,
) {
  return getRuntimeArtifactPath(repoRoot, config, "heartbeat.json");
}

export function getSupervisorStatusPath(
  repoRoot: string,
  config: Pick<WorkflowConfig, "stateFile">,
) {
  return getRuntimeArtifactPath(repoRoot, config, "supervisor-status.json");
}

export function getLaunchdStdoutPath(
  repoRoot: string,
  config: Pick<WorkflowConfig, "stateFile">,
) {
  return getRuntimeArtifactPath(repoRoot, config, "launchd.out.log");
}

export function getLaunchdStderrPath(
  repoRoot: string,
  config: Pick<WorkflowConfig, "stateFile">,
) {
  return getRuntimeArtifactPath(repoRoot, config, "launchd.err.log");
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

function getReviewRemediationTaskIdPrefix(reviewId: string) {
  const reviewMatch = reviewId.match(/^review-(\d+)$/i);
  if (reviewMatch) {
    return `REVIEW-${reviewMatch[1]}-`;
  }

  const sanitized = reviewId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${sanitized || "REVIEW"}-`;
}

function isReviewRemediationTask(task: Pick<Task, "id">): boolean {
  return /^REVIEW-\d+-\d+$/.test(task.id);
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
    const remediationDifference =
      Number(!isReviewRemediationTask(left)) -
      Number(!isReviewRemediationTask(right));
    return priorityDifference !== 0
      ? priorityDifference
      : remediationDifference !== 0
        ? remediationDifference
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

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }

  return unique;
}

function getCompletedTaskIdsFromHistory(
  history: OrchestratorState["history"],
): string[] {
  return dedupeStrings(
    history
      .filter((entry) => entry.status === "completed" && entry.taskId)
      .map((entry) => entry.taskId ?? ""),
  );
}

function normalizeTaskFailureKind(
  value: unknown,
): OrchestratorTaskFailureRecord["lastFailureKind"] {
  return value === "agent" || value === "runtime" || value === "integration"
    ? value
    : "runtime";
}

function normalizeTaskFailures(
  rawTaskFailures: unknown,
): OrchestratorState["taskFailures"] {
  if (!rawTaskFailures || typeof rawTaskFailures !== "object") {
    return {};
  }

  const taskFailures: OrchestratorState["taskFailures"] = {};

  for (const [taskId, rawEntry] of Object.entries(rawTaskFailures)) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const entry = rawEntry as Partial<OrchestratorTaskFailureRecord>;
    if (
      typeof entry.consecutiveFailures !== "number" ||
      !Number.isInteger(entry.consecutiveFailures) ||
      entry.consecutiveFailures <= 0 ||
      typeof entry.lastFailureAt !== "string" ||
      typeof entry.lastFailureNote !== "string"
    ) {
      continue;
    }

    taskFailures[taskId] = {
      consecutiveFailures: entry.consecutiveFailures,
      lastFailureAt: entry.lastFailureAt,
      lastFailureKind: normalizeTaskFailureKind(entry.lastFailureKind),
      lastFailureNote: entry.lastFailureNote,
      lastBackoffSeconds:
        typeof entry.lastBackoffSeconds === "number" &&
        Number.isInteger(entry.lastBackoffSeconds) &&
        entry.lastBackoffSeconds >= 0
          ? entry.lastBackoffSeconds
          : 0,
      nextRetryAt:
        typeof entry.nextRetryAt === "string" ? entry.nextRetryAt : null,
      staleWorkspace: entry.staleWorkspace === true,
      staleWorkspaceReason:
        typeof entry.staleWorkspaceReason === "string"
          ? entry.staleWorkspaceReason
          : null,
    };
  }

  return taskFailures;
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
      lastReviewedCompletionCount: 0,
      reviews: [],
      taskFailures: {},
      history: [],
    };
    writeFileSync(statePath, JSON.stringify(initialState, null, 2) + "\n");
    return initialState;
  }

  const state = JSON.parse(
    readFileSync(statePath, "utf8"),
  ) as Partial<OrchestratorState>;
  const history = Array.isArray(state.history) ? state.history : [];
  const completedTaskIds = getCompletedTaskIdsFromHistory(history);
  const lastReviewedCompletionCount =
    typeof state.lastReviewedCompletionCount === "number" &&
    Number.isInteger(state.lastReviewedCompletionCount) &&
    state.lastReviewedCompletionCount >= 0
      ? Math.min(state.lastReviewedCompletionCount, completedTaskIds.length)
      : 0;

  return {
    workflowPath: state.workflowPath ?? config.workflowPath,
    iteration: state.iteration ?? 0,
    activeTaskId: state.activeTaskId ?? null,
    commitsSincePush: state.commitsSincePush ?? 0,
    lastCommittedTaskId: state.lastCommittedTaskId ?? null,
    lastCommitSha: state.lastCommitSha ?? null,
    lastReviewedCompletionCount,
    reviews: Array.isArray(state.reviews) ? state.reviews : [],
    taskFailures: normalizeTaskFailures(state.taskFailures),
    history,
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

function createGitWorktree(
  repoRoot: string,
  workspacePath: string,
  branchName: string,
  baseRef: string,
  taskId: string,
) {
  const result = runGit(
    ["worktree", "add", "-B", branchName, workspacePath, baseRef],
    repoRoot,
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to create git worktree for ${taskId}: ${gitError(result, "git worktree add failed")}`,
    );
  }
}

function removeGitWorktree(
  repoRoot: string,
  workspacePath: string,
  taskId: string,
) {
  if (!existsSync(workspacePath)) {
    return;
  }

  const removeResult = runGit(
    ["worktree", "remove", "--force", workspacePath],
    repoRoot,
  );
  if (removeResult.status !== 0) {
    throw new Error(
      `Failed to remove git worktree for ${taskId}: ${gitError(removeResult, "git worktree remove failed")}`,
    );
  }

  const pruneResult = runGit(["worktree", "prune"], repoRoot);
  if (pruneResult.status !== 0) {
    throw new Error(
      `Failed to prune git worktrees after removing ${taskId}: ${gitError(pruneResult, "git worktree prune failed")}`,
    );
  }
}

function resolveIntegrationBranch(
  repoRoot: string,
  config: Pick<WorkflowConfig, "requiredBranch">,
) {
  return config.requiredBranch ?? getCurrentBranch(repoRoot);
}

function shouldRefreshIdleTaskWorkspace(
  repoRoot: string,
  workspacePath: string,
  integrationBranch: string,
) {
  if (!existsSync(workspacePath)) {
    return false;
  }

  if (listDirtyCheckoutEntries(workspacePath).length > 0) {
    return false;
  }

  if (listUniqueCommits(workspacePath, integrationBranch).length > 0) {
    return false;
  }

  const workspaceHead = getHeadCommit(workspacePath);
  const integrationHead = getHeadCommit(repoRoot);
  return (
    !!workspaceHead && !!integrationHead && workspaceHead !== integrationHead
  );
}

function refreshTaskWorkspace(
  repoRoot: string,
  config: WorkflowConfig,
  task: Task,
  integrationBranch: string,
) {
  const workspacePath = previewWorkspacePath(repoRoot, config, task);
  const branchName = sanitizeBranchName(task.id);
  ensureDirectory(dirname(workspacePath));
  removeGitWorktree(repoRoot, workspacePath, task.id);
  createGitWorktree(
    repoRoot,
    workspacePath,
    branchName,
    integrationBranch,
    task.id,
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
    createGitWorktree(repoRoot, workspacePath, branchName, baseRef, task.id);
  }

  return { path: workspacePath, kind: "git_worktree", branchName };
}

function ensureTaskWorkspace(
  repoRoot: string,
  config: WorkflowConfig,
  task: Task,
  state: Pick<OrchestratorState, "taskFailures">,
): WorkspaceHandle {
  if (config.workspaceMode === "shared") {
    return ensureWorkspace(repoRoot, config, task);
  }

  const integrationBranch = resolveIntegrationBranch(repoRoot, config);
  if (!integrationBranch) {
    throw new Error(
      `Could not determine the integration branch for ${task.id} workspace refresh.`,
    );
  }

  const taskFailure = getTaskFailureRecord(state, task.id);
  const workspacePath = previewWorkspacePath(repoRoot, config, task);
  let refreshedStaleWorkspace = false;

  if (taskFailure?.staleWorkspace) {
    if (existsSync(workspacePath)) {
      refreshTaskWorkspace(repoRoot, config, task, integrationBranch);
    }
    refreshedStaleWorkspace = true;
  } else if (
    shouldRefreshIdleTaskWorkspace(repoRoot, workspacePath, integrationBranch)
  ) {
    refreshTaskWorkspace(repoRoot, config, task, integrationBranch);
  }

  const workspace = ensureWorkspace(repoRoot, config, task);
  if (refreshedStaleWorkspace) {
    clearTaskWorkspaceStale(state, task.id);
  }
  return workspace;
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
    `2. Do not edit task-tracker status metadata in ${task.filePath}; leave the assigned task's \`Status\` line unchanged and let the orchestrator record terminal \`done\` or \`blocked\` status on the integration branch.`,
    `3. Update ${config.decisionFile} if you make or revise a consequential implementation decision.`,
    "4. Do not edit the orchestrator progress/state files directly; the orchestrator records runtime progress for you.",
    "5. Issue developer tool calls serially; do not start a second shell or file-edit command until the previous tool call has returned.",
    "6. Run the most relevant tests or validation commands for the files you changed when feasible.",
    `7. If the task is fully complete, say \`TASK_DONE ${task.id}\` in the final message.`,
    `8. If the task is blocked, say \`TASK_BLOCKED ${task.id}: <reason>\` in the final message.`,
    `9. If all tracked tasks are complete, say \`${config.completionPhrase}\` in the final message.`,
  ].join("\n");
}

type ReviewTaskContext = {
  task: Task;
  completedAt: string;
  historyNote: string;
  lastMessage: string;
};

function truncatePromptBlock(value: string, maxLength = 2000) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[truncated]`;
}

function listCompletedTaskIds(
  state: Pick<OrchestratorState, "history">,
): string[] {
  return getCompletedTaskIdsFromHistory(state.history);
}

function getPendingReviewTaskIds(
  workflow: Pick<WorkflowConfig, "reviewEveryTasks">,
  state: Pick<OrchestratorState, "history" | "lastReviewedCompletionCount">,
): string[] {
  if (workflow.reviewEveryTasks <= 0) {
    return [];
  }

  const completedTaskIds = listCompletedTaskIds(state);
  const reviewStart = Math.min(
    state.lastReviewedCompletionCount,
    completedTaskIds.length,
  );
  return completedTaskIds.slice(
    reviewStart,
    reviewStart + workflow.reviewEveryTasks,
  );
}

function shouldRunReview(
  workflow: Pick<WorkflowConfig, "reviewEveryTasks">,
  state: Pick<
    OrchestratorState,
    "activeTaskId" | "history" | "lastReviewedCompletionCount"
  >,
  actionableTasks: Task[],
) {
  if (workflow.reviewEveryTasks <= 0 || state.activeTaskId) {
    return false;
  }

  if (actionableTasks.some((task) => task.status === "in-progress")) {
    return false;
  }

  return (
    getPendingReviewTaskIds(workflow, state).length ===
    workflow.reviewEveryTasks
  );
}

function getReviewTaskContexts(
  repoRoot: string,
  config: WorkflowConfig,
  actionableTasks: Task[],
  state: OrchestratorState,
): ReviewTaskContext[] {
  const actionableById = new Map(
    actionableTasks.map((task) => [task.id, task]),
  );
  const completionNotes = new Map<
    string,
    { timestamp: string; note: string }
  >();

  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    const entry = state.history[index];
    if (
      entry.status !== "completed" ||
      !entry.taskId ||
      completionNotes.has(entry.taskId)
    ) {
      continue;
    }

    completionNotes.set(entry.taskId, {
      timestamp: entry.timestamp,
      note: entry.note,
    });
  }

  return getPendingReviewTaskIds(config, state).map((taskId) => {
    const task = actionableById.get(taskId);
    if (!task) {
      throw new Error(
        `Scheduled review task ${taskId} is no longer present in the configured task sources.`,
      );
    }

    const completion = completionNotes.get(taskId);
    const lastMessagePath = getLastMessagePath(repoRoot, config, taskId);
    return {
      task,
      completedAt: completion?.timestamp ?? "",
      historyNote: completion?.note ?? `${taskId} completed.`,
      lastMessage: existsSync(lastMessagePath)
        ? readFileSync(lastMessagePath, "utf8").trim()
        : "",
    };
  });
}

function createReviewTask(
  reviewId: string,
  workflow: WorkflowConfig,
  reviewedTasks: ReviewTaskContext[],
): Task {
  return {
    id: reviewId,
    title: `Review ${reviewedTasks.length} completed task${reviewedTasks.length === 1 ? "" : "s"}`,
    status: "in-progress",
    priority: "P0",
    dependsOn: [],
    filePath: workflow.taskSources[0] ?? workflow.workflowPath,
    heading: `Review ${reviewId}`,
    headingLevel: 2,
    sectionBody: reviewedTasks
      .map((entry) => `- ${entry.task.id}: ${entry.task.title}`)
      .join("\n"),
    order: -1,
    sortIndex: Number.MAX_SAFE_INTEGER,
  };
}

function buildReviewPrompt(
  config: WorkflowConfig,
  reviewId: string,
  reviewedTasks: ReviewTaskContext[],
  workspacePath: string,
): string {
  const remediationIdPrefix = getReviewRemediationTaskIdPrefix(reviewId);
  const instructionList =
    config.instructionFiles.length > 0
      ? config.instructionFiles.map((file) => `- ${file}`).join("\n")
      : "- None";
  const workspaceNote =
    workspacePath === process.cwd() ? "shared repo workspace" : workspacePath;
  const reviewSections = reviewedTasks
    .map((entry, index) => {
      const sectionLines = [
        `### ${index + 1}. ${entry.task.id} ${entry.task.title}`,
        `- Completed at: ${entry.completedAt || "unknown"}`,
        `- Task file: ${entry.task.filePath}`,
        `- Completion note: ${entry.historyNote}`,
        "- Current task section:",
        "```md",
        `### ${entry.task.heading}`,
        entry.task.sectionBody,
        "```",
      ];

      if (entry.lastMessage) {
        sectionLines.push(
          "- Last agent message:",
          "```text",
          truncatePromptBlock(entry.lastMessage),
          "```",
        );
      } else {
        sectionLines.push("- Last agent message: (not captured)");
      }

      return sectionLines.join("\n");
    })
    .join("\n\n");

  return [
    `Workflow: ${config.name}`,
    `Review ID: ${reviewId}`,
    `Review Cadence: every ${config.reviewEveryTasks} completed task${config.reviewEveryTasks === 1 ? "" : "s"}`,
    `Workspace: ${workspaceNote}`,
    "",
    config.workflowBody,
    "",
    "Instruction files to read first:",
    instructionList,
    "",
    "Decision doc:",
    `- Path: ${config.decisionFile}`,
    "- Update it if the review leads you to a consequential repo or workflow decision.",
    "",
    "Review scope:",
    reviewSections,
    "",
    "Execution rules:",
    `1. Review the ${reviewedTasks.length} completed task${reviewedTasks.length === 1 ? "" : "s"} listed above together before changing anything.`,
    "2. Inspect the current repo state, task docs, and relevant validations as needed to confirm the finished work still matches its acceptance criteria.",
    "3. If you find missed acceptance criteria, regressions, or follow-up work that must happen soon, add remediation task entries directly to the relevant task doc.",
    `4. Remediation task IDs must use \`${remediationIdPrefix}01\`, \`${remediationIdPrefix}02\`, and so on.`,
    "5. Append review-created tasks as a contiguous block at the end of the task doc you add them to.",
    "6. Any remediation task you create must start as `pending`, use `Priority: P0`, and list only reviewed task IDs in `Depends on`.",
    "7. Do not make remediation tasks depend on the synthetic review task or unrelated unfinished work.",
    "8. Follow the existing task-doc format (`ID`, `Status`, `Priority`, `Depends on`) so the scheduler can pick the new work up.",
    "9. Issue developer tool calls serially; do not start a second shell or file-edit command until the previous tool call has returned.",
    "10. Do not edit the orchestrator runtime progress/state files directly; the orchestrator records the review outcome for you.",
    "11. Start your final message with `REVIEW_DONE:` and list any remediation task IDs you created.",
  ].join("\n");
}

export type AgentRunResult = {
  exitCode: number;
  lastMessage: string;
  lastMessagePath: string;
  commandLine: string;
  spawnError: string | null;
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
  contentConflict: boolean;
};

class WorkspaceRefreshRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRefreshRequiredError";
  }
}

function getLastMessagePath(
  repoRoot: string,
  config: WorkflowConfig,
  identifier: string,
) {
  return join(
    getRuntimeRoot(repoRoot, config),
    `${sanitizePathSegment(identifier)}-last-message.txt`,
  );
}

export function getHeadCommit(repoPath: string): string | null {
  const result = runGit(["rev-parse", "--short", "HEAD"], repoPath);
  if (result.status !== 0) {
    return null;
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : null;
}

type TaskTrackerUpdateResult = {
  updated: boolean;
  previousStatus: TaskStatus | null;
};

function updateTaskStatusInTaskSource(
  repoRoot: string,
  task: Pick<Task, "id" | "filePath">,
  nextStatus: TaskStatus,
): TaskTrackerUpdateResult {
  const taskSourcePath = resolvePath(repoRoot, task.filePath);
  const lines = readFileSync(taskSourcePath, "utf8").split(/\r?\n/);
  let foundTaskId = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^(#{2,6})\s+/.test(line) && foundTaskId) {
      break;
    }

    const idMatch = line.match(/^\s*-\s+\*\*ID\*\*:\s+`?([^`\n]+)`?/);
    if (!foundTaskId) {
      if (idMatch && idMatch[1].trim() === task.id) {
        foundTaskId = true;
      }
      continue;
    }

    const statusMatch = line.match(
      /^(\s*-\s+\*\*Status\*\*:\s+)(`?)([^`\n]+)(`?)(.*)$/,
    );
    if (!statusMatch) {
      continue;
    }

    const currentStatus = normalizeStatus(statusMatch[3] ?? null);
    if (currentStatus === nextStatus) {
      return {
        updated: false,
        previousStatus: currentStatus,
      };
    }

    const usesBackticks = statusMatch[2] === "`" || statusMatch[4] === "`";
    lines[index] =
      `${statusMatch[1]}${usesBackticks ? "`" : ""}${nextStatus}${usesBackticks ? "`" : ""}${statusMatch[5]}`;
    writeFileSync(taskSourcePath, lines.join("\n"));
    return {
      updated: true,
      previousStatus: currentStatus,
    };
  }

  if (!foundTaskId) {
    throw new Error(`${task.id} is not present in ${task.filePath}.`);
  }

  throw new Error(
    `${task.id} in ${task.filePath} is missing a Status metadata line.`,
  );
}

function restoreTaskStatusMetadata(
  repoRoot: string,
  task: Pick<Task, "id" | "filePath" | "status">,
  observedStatus: TaskStatus,
) {
  if (observedStatus === task.status) {
    return;
  }

  updateTaskStatusInTaskSource(repoRoot, task, task.status);
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

function listDirtyCheckoutEntries(repoPath: string): string[] {
  const statusResult = runGit(["status", "--porcelain"], repoPath);
  if (statusResult.status !== 0) {
    throw new Error(
      `Failed to inspect integration checkout status: ${gitError(statusResult, "git status failed")}`,
    );
  }

  return statusResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const status = line.slice(0, 2).trim() || line.slice(0, 2);
      const path = line.slice(3).trim();
      return `${status} ${path}`.trim();
    });
}

function summarizeDirtyCheckout(entries: string[], maxEntries = 5): string {
  const visibleEntries = entries.slice(0, maxEntries);
  const hiddenCount = entries.length - visibleEntries.length;
  if (hiddenCount <= 0) {
    return visibleEntries.join(", ");
  }

  return `${visibleEntries.join(", ")}, and ${hiddenCount} more`;
}

function assertCleanIntegrationCheckout(
  repoRoot: string,
  integrationBranch: string,
  subject: string,
) {
  const dirtyEntries = listDirtyCheckoutEntries(repoRoot);
  if (dirtyEntries.length === 0) {
    return;
  }

  throw new Error(
    `${subject} cannot update ${integrationBranch} because the shared integration checkout has uncommitted changes: ${summarizeDirtyCheckout(dirtyEntries)}. Clean or commit those paths and rerun.`,
  );
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

function commitTrackedPathChange(
  repoPath: string,
  filePath: string,
  message: string,
  options: { amend?: boolean } = {},
): RepoCommitResult {
  const addResult = runGit(["add", "--", filePath], repoPath);
  if (addResult.status !== 0) {
    return {
      committed: false,
      commitSha: null,
      error: gitError(addResult, "git add failed"),
    };
  }

  const diffResult = runGit(["diff", "--cached", "--quiet"], repoPath);
  if (diffResult.status === 0) {
    return { committed: false, commitSha: null, error: null };
  }
  if (diffResult.status !== 1) {
    return {
      committed: false,
      commitSha: null,
      error: gitError(diffResult, "git diff --cached failed"),
    };
  }

  const commitArgs = options.amend
    ? ["commit", "--amend", "--no-edit"]
    : ["commit", "-m", message];
  const commitResult = runGit(commitArgs, repoPath);
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

function recordTerminalTaskStatusOnIntegrationBranch(params: {
  repoRoot: string;
  task: Pick<Task, "id" | "filePath">;
  terminalStatus: "completed" | "blocked";
  commitMessage: string;
  amendExistingCommit: boolean;
}): RepoCommitResult {
  const { repoRoot, task, terminalStatus, commitMessage, amendExistingCommit } =
    params;
  const nextStatus: TaskStatus =
    terminalStatus === "completed" ? "done" : "blocked";
  const statusUpdateResult = updateTaskStatusInTaskSource(
    repoRoot,
    task,
    nextStatus,
  );

  if (!statusUpdateResult.updated) {
    return { committed: false, commitSha: null, error: null };
  }

  return commitTrackedPathChange(repoRoot, task.filePath, commitMessage, {
    amend: amendExistingCommit,
  });
}

function isCherryPickContentConflict(result: ReturnType<typeof runGit>) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  return (
    output.includes("conflict (") ||
    output.includes("merge conflict") ||
    output.includes("could not apply")
  );
}

export function cherryPickCommits(
  repoRoot: string,
  commits: string[],
): CherryPickResult {
  if (commits.length === 0) {
    return {
      applied: false,
      commitCount: 0,
      lastCommitSha: null,
      error: null,
      contentConflict: false,
    };
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
        contentConflict: isCherryPickContentConflict(cherryPickResult),
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
    contentConflict: false,
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

function runAgentCommand(
  repoRoot: string,
  config: WorkflowConfig,
  workspacePath: string,
  identifier: string,
  prompt: string,
  extraEnv: Record<string, string>,
): AgentRunResult {
  const lastMessagePath = getLastMessagePath(repoRoot, config, identifier);
  ensureDirectory(dirname(lastMessagePath));
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
      ORCHESTRATOR_WORKFLOW: config.name,
      ...extraEnv,
    },
  });

  return {
    exitCode: child.status ?? 1,
    lastMessagePath,
    lastMessage: existsSync(lastMessagePath)
      ? readFileSync(lastMessagePath, "utf8")
      : "",
    commandLine: [config.agentCommand, ...args].join(" "),
    spawnError: child.error?.message ?? null,
  };
}

export function runAgentForTask(
  repoRoot: string,
  config: WorkflowConfig,
  task: Task,
  workspacePath: string,
  prompt: string,
): AgentRunResult {
  return runAgentCommand(repoRoot, config, workspacePath, task.id, prompt, {
    ORCHESTRATOR_RUN_KIND: "task",
    ORCHESTRATOR_TASK_ID: task.id,
    ORCHESTRATOR_TASK_FILE: task.filePath,
  });
}

function getReviewLogPath(
  repoRoot: string,
  config: Pick<WorkflowConfig, "stateFile">,
): string {
  return getRuntimeArtifactPath(repoRoot, config, "reviews.md");
}

function summarizeMessage(message: string, fallback: string): string {
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine ?? fallback).replace(/\s+/g, " ").trim();
}

function appendReviewOutcome(params: {
  repoPath: string;
  displayRoot: string;
  workflow: WorkflowConfig;
  reviewId: string;
  reviewedAt: string;
  reviewTasks: ReviewTaskContext[];
  remediationTasks: Task[];
  summary: string;
  lastMessagePath: string;
}) {
  const {
    repoPath,
    displayRoot,
    workflow,
    reviewId,
    reviewedAt,
    reviewTasks,
    remediationTasks,
    summary,
    lastMessagePath,
  } = params;
  const reviewLogPath = getReviewLogPath(repoPath, workflow);
  const existing = existsSync(reviewLogPath)
    ? readFileSync(reviewLogPath, "utf8")
    : `# ${workflow.name} Reviews\n\n`;
  const reviewedTaskSummary = reviewTasks
    .map(({ task }) => `${task.id} (${task.title})`)
    .join(", ");
  const remediationTaskSummary =
    remediationTasks.length > 0
      ? remediationTasks
          .map((task) => `${task.id} (${task.filePath})`)
          .join(", ")
      : "None";

  ensureDirectory(dirname(reviewLogPath));
  writeFileSync(
    reviewLogPath,
    existing +
      [
        `## ${reviewId} - ${reviewedAt}`,
        `- Reviewed tasks: ${reviewedTaskSummary}`,
        `- Remediation tasks: ${remediationTaskSummary}`,
        `- Summary: ${summary}`,
        `- Last message file: ${relative(displayRoot, lastMessagePath) || lastMessagePath}`,
        "",
      ].join("\n"),
  );
}

function runAgentForReview(
  repoRoot: string,
  config: WorkflowConfig,
  reviewId: string,
  workspacePath: string,
  prompt: string,
  reviewedTaskIds: string[],
): AgentRunResult {
  return runAgentCommand(repoRoot, config, workspacePath, reviewId, prompt, {
    ORCHESTRATOR_RUN_KIND: "review",
    ORCHESTRATOR_REVIEW_ID: reviewId,
    ORCHESTRATOR_REVIEW_TASK_IDS: reviewedTaskIds.join(","),
  });
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

function parseIntegerFlag(
  rawValue: string,
  flag: string,
  options: { min: number },
): number {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < options.min) {
    const qualifier =
      options.min === 0 ? "a non-negative integer" : "a positive integer";
    throw new Error(`${flag} must be ${qualifier}.`);
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

export function formatOrchestratorSupervisorCliUsage(
  scriptPath = "scripts/orchestrator-supervisor.ts",
): string {
  return [
    `Usage: bun run ${scriptPath} [command] [options]`,
    "",
    "Commands:",
    "  run                    Run the supervisor in the foreground (default)",
    "  start                  Start the supervisor in the background",
    "  stop                   Stop the background supervisor for the workflow",
    "  status                 Show the current supervisor and worker state",
    "",
    "Options:",
    `  --workflow <path>              Workflow file to load (default: ${DEFAULT_WORKFLOW_FILE})`,
    `  --stall-seconds <n>            Restart when runtime health stays stale this long (default: ${DEFAULT_SUPERVISOR_STALL_SECONDS})`,
    `  --check-interval-seconds <n>   How often to poll runtime health (default: ${DEFAULT_SUPERVISOR_CHECK_INTERVAL_SECONDS})`,
    `  --restart-delay-seconds <n>    Wait before restarting a dead or stalled worker (default: ${DEFAULT_SUPERVISOR_RESTART_DELAY_SECONDS})`,
    "  --help                         Show this help text",
  ].join("\n");
}

export function parseOrchestratorSupervisorCliArgs(
  argv: string[],
): OrchestratorSupervisorCliOptions {
  const options: OrchestratorSupervisorCliOptions = {
    command: "run",
    workflowFile: DEFAULT_WORKFLOW_FILE,
    stallSeconds: DEFAULT_SUPERVISOR_STALL_SECONDS,
    checkIntervalSeconds: DEFAULT_SUPERVISOR_CHECK_INTERVAL_SECONDS,
    restartDelaySeconds: DEFAULT_SUPERVISOR_RESTART_DELAY_SECONDS,
    help: false,
  };

  let index = 0;
  const firstArg = argv[0];
  if (
    firstArg === "run" ||
    firstArg === "start" ||
    firstArg === "stop" ||
    firstArg === "status"
  ) {
    options.command = firstArg;
    index = 1;
  }

  for (; index < argv.length; index += 1) {
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

    if (arg.startsWith("--stall-seconds=")) {
      options.stallSeconds = parseIntegerFlag(
        arg.slice("--stall-seconds=".length),
        "--stall-seconds",
        { min: 1 },
      );
      continue;
    }

    if (arg === "--stall-seconds") {
      options.stallSeconds = parseIntegerFlag(
        readCliValue(argv, index, "--stall-seconds"),
        "--stall-seconds",
        { min: 1 },
      );
      index += 1;
      continue;
    }

    if (arg.startsWith("--check-interval-seconds=")) {
      options.checkIntervalSeconds = parseIntegerFlag(
        arg.slice("--check-interval-seconds=".length),
        "--check-interval-seconds",
        { min: 1 },
      );
      continue;
    }

    if (arg === "--check-interval-seconds") {
      options.checkIntervalSeconds = parseIntegerFlag(
        readCliValue(argv, index, "--check-interval-seconds"),
        "--check-interval-seconds",
        { min: 1 },
      );
      index += 1;
      continue;
    }

    if (arg.startsWith("--restart-delay-seconds=")) {
      options.restartDelaySeconds = parseIntegerFlag(
        arg.slice("--restart-delay-seconds=".length),
        "--restart-delay-seconds",
        { min: 0 },
      );
      continue;
    }

    if (arg === "--restart-delay-seconds") {
      options.restartDelaySeconds = parseIntegerFlag(
        readCliValue(argv, index, "--restart-delay-seconds"),
        "--restart-delay-seconds",
        { min: 0 },
      );
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function formatOrchestratorLaunchdCliUsage(
  scriptPath = "scripts/orchestrator-launchd.ts",
): string {
  return [
    `Usage: bun run ${scriptPath} [command] [options]`,
    "",
    "Commands:",
    "  print                  Print the generated LaunchAgent plist (default)",
    "  install                Write the plist to LaunchAgents and load it with launchctl",
    "  uninstall              Unload the plist and remove it from LaunchAgents",
    "",
    "Options:",
    `  --workflow <path>              Workflow file to load (default: ${DEFAULT_WORKFLOW_FILE})`,
    "  --label <value>                Override the generated launchd label",
    `  --launch-agent-dir <path>      Override the LaunchAgents directory (default: ~/${DEFAULT_LAUNCH_AGENT_DIR})`,
    "  --path <value>                 PATH to inject into the LaunchAgent environment",
    "  --home <path>                  HOME to inject into the LaunchAgent environment",
    `  --stall-seconds <n>            Supervisor stall timeout to encode in ProgramArguments (default: ${DEFAULT_SUPERVISOR_STALL_SECONDS})`,
    `  --check-interval-seconds <n>   Supervisor poll interval to encode in ProgramArguments (default: ${DEFAULT_SUPERVISOR_CHECK_INTERVAL_SECONDS})`,
    `  --restart-delay-seconds <n>    Supervisor restart delay to encode in ProgramArguments (default: ${DEFAULT_SUPERVISOR_RESTART_DELAY_SECONDS})`,
    "  --help                         Show this help text",
  ].join("\n");
}

export function parseOrchestratorLaunchdCliArgs(
  argv: string[],
): OrchestratorLaunchdCliOptions {
  const options: OrchestratorLaunchdCliOptions = {
    command: "print",
    workflowFile: DEFAULT_WORKFLOW_FILE,
    label: null,
    launchAgentDir: null,
    path: null,
    home: null,
    stallSeconds: DEFAULT_SUPERVISOR_STALL_SECONDS,
    checkIntervalSeconds: DEFAULT_SUPERVISOR_CHECK_INTERVAL_SECONDS,
    restartDelaySeconds: DEFAULT_SUPERVISOR_RESTART_DELAY_SECONDS,
    help: false,
  };

  let index = 0;
  const firstArg = argv[0];
  if (
    firstArg === "print" ||
    firstArg === "install" ||
    firstArg === "uninstall"
  ) {
    options.command = firstArg;
    index = 1;
  }

  for (; index < argv.length; index += 1) {
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

    if (arg.startsWith("--label=")) {
      const label = arg.slice("--label=".length).trim();
      if (!label) {
        throw new Error("--label requires a value.");
      }
      options.label = label;
      continue;
    }

    if (arg === "--label") {
      options.label = readCliValue(argv, index, "--label").trim();
      if (!options.label) {
        throw new Error("--label requires a value.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--launch-agent-dir=")) {
      const launchAgentDir = arg.slice("--launch-agent-dir=".length).trim();
      if (!launchAgentDir) {
        throw new Error("--launch-agent-dir requires a value.");
      }
      options.launchAgentDir = launchAgentDir;
      continue;
    }

    if (arg === "--launch-agent-dir") {
      options.launchAgentDir = readCliValue(
        argv,
        index,
        "--launch-agent-dir",
      ).trim();
      if (!options.launchAgentDir) {
        throw new Error("--launch-agent-dir requires a value.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--path=")) {
      const pathValue = arg.slice("--path=".length);
      if (!pathValue) {
        throw new Error("--path requires a value.");
      }
      options.path = pathValue;
      continue;
    }

    if (arg === "--path") {
      options.path = readCliValue(argv, index, "--path");
      index += 1;
      continue;
    }

    if (arg.startsWith("--home=")) {
      const homeValue = arg.slice("--home=".length).trim();
      if (!homeValue) {
        throw new Error("--home requires a value.");
      }
      options.home = homeValue;
      continue;
    }

    if (arg === "--home") {
      options.home = readCliValue(argv, index, "--home").trim();
      if (!options.home) {
        throw new Error("--home requires a value.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--stall-seconds=")) {
      options.stallSeconds = parseIntegerFlag(
        arg.slice("--stall-seconds=".length),
        "--stall-seconds",
        { min: 1 },
      );
      continue;
    }

    if (arg === "--stall-seconds") {
      options.stallSeconds = parseIntegerFlag(
        readCliValue(argv, index, "--stall-seconds"),
        "--stall-seconds",
        { min: 1 },
      );
      index += 1;
      continue;
    }

    if (arg.startsWith("--check-interval-seconds=")) {
      options.checkIntervalSeconds = parseIntegerFlag(
        arg.slice("--check-interval-seconds=".length),
        "--check-interval-seconds",
        { min: 1 },
      );
      continue;
    }

    if (arg === "--check-interval-seconds") {
      options.checkIntervalSeconds = parseIntegerFlag(
        readCliValue(argv, index, "--check-interval-seconds"),
        "--check-interval-seconds",
        { min: 1 },
      );
      index += 1;
      continue;
    }

    if (arg.startsWith("--restart-delay-seconds=")) {
      options.restartDelaySeconds = parseIntegerFlag(
        arg.slice("--restart-delay-seconds=".length),
        "--restart-delay-seconds",
        { min: 0 },
      );
      continue;
    }

    if (arg === "--restart-delay-seconds") {
      options.restartDelaySeconds = parseIntegerFlag(
        readCliValue(argv, index, "--restart-delay-seconds"),
        "--restart-delay-seconds",
        { min: 0 },
      );
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function getRepoLockPath(repoRoot: string, workflow: WorkflowConfig): string {
  return resolve(getRuntimeRoot(repoRoot, workflow), REPO_LOCK_NAME);
}

function getWorkerLockPath(repoRoot: string, workflow: WorkflowConfig): string {
  return join(
    getRuntimeRoot(repoRoot, workflow),
    `${WORKER_LOCK_PREFIX}-${sanitizePathSegment(workflow.workflowPath)}.lock`,
  );
}

function getSupervisorLockPath(
  repoRoot: string,
  workflow: WorkflowConfig,
): string {
  return join(
    getRuntimeRoot(repoRoot, workflow),
    `${SUPERVISOR_LOCK_PREFIX}-${sanitizePathSegment(workflow.workflowPath)}.lock`,
  );
}

function sanitizeLaunchdLabelPart(value: string): string {
  const sanitized = sanitizePathSegment(value)
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "");
  return sanitized || "workflow";
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatLaunchctlError(
  result: LaunchctlCommandResult,
  fallback: string,
): string {
  return (
    result.error?.message ||
    result.stderr?.trim() ||
    result.stdout?.trim() ||
    fallback
  );
}

function resolveLaunchdHome(
  options: Pick<OrchestratorLaunchdCliOptions, "home">,
  runtime: Pick<OrchestratorLaunchdRuntimeOptions, "env" | "homeDir">,
): string {
  return options.home ?? runtime.env?.HOME ?? runtime.homeDir ?? homedir();
}

function resolveLaunchdPathValue(
  options: Pick<OrchestratorLaunchdCliOptions, "path">,
  runtime: Pick<OrchestratorLaunchdRuntimeOptions, "env">,
): string {
  return options.path ?? runtime.env?.PATH ?? DEFAULT_LAUNCHD_PATH;
}

function getLaunchdDomainTarget(uid: number): string {
  return `gui/${uid}`;
}

function getLaunchdServiceTarget(uid: number, label: string): string {
  return `${getLaunchdDomainTarget(uid)}/${label}`;
}

function resolveLaunchdUid(
  runtime: Pick<OrchestratorLaunchdRuntimeOptions, "uid">,
): number | null {
  if (typeof runtime.uid === "number" && Number.isInteger(runtime.uid)) {
    return runtime.uid;
  }

  if (typeof process.getuid === "function") {
    const uid = process.getuid();
    if (Number.isInteger(uid)) {
      return uid;
    }
  }

  return null;
}

function resolveLaunchAgentDirectory(
  homePath: string,
  override: string | null,
): string {
  const configuredPath = override ?? DEFAULT_LAUNCH_AGENT_DIR;
  return isAbsolute(configuredPath)
    ? configuredPath
    : resolve(homePath, configuredPath);
}

export function buildOrchestratorLaunchdLabel(
  repoRoot: string,
  workflow: Pick<WorkflowConfig, "workflowPath">,
  override: string | null = null,
): string {
  if (override && override.trim()) {
    return override.trim();
  }

  return [
    "dev",
    "orchestrator",
    sanitizeLaunchdLabelPart(basename(repoRoot) || "repo"),
    sanitizeLaunchdLabelPart(workflow.workflowPath.replace(/\.[^.]+$/, "")),
  ].join(".");
}

export function getOrchestratorLaunchdPlistPath(
  repoRoot: string,
  workflow: Pick<WorkflowConfig, "workflowPath">,
  options: Pick<
    OrchestratorLaunchdCliOptions,
    "label" | "launchAgentDir" | "home"
  >,
  runtime: Pick<OrchestratorLaunchdRuntimeOptions, "env" | "homeDir"> = {},
): string {
  const homePath = resolveLaunchdHome(options, runtime);
  const launchAgentDirectory = resolveLaunchAgentDirectory(
    homePath,
    options.launchAgentDir,
  );
  const label = buildOrchestratorLaunchdLabel(
    repoRoot,
    workflow,
    options.label,
  );
  return join(launchAgentDirectory, `${label}.plist`);
}

function resolveLaunchdSupervisorScriptPath(
  runtime: Pick<OrchestratorLaunchdRuntimeOptions, "scriptPath">,
): string {
  const launchdScriptPath = resolve(
    runtime.scriptPath ?? process.argv[1] ?? "scripts/orchestrator-launchd.ts",
  );
  return resolve(dirname(launchdScriptPath), "orchestrator-supervisor.ts");
}

export function buildOrchestratorLaunchdPlist(
  repoRoot: string,
  workflow: WorkflowConfig,
  options: Pick<
    OrchestratorLaunchdCliOptions,
    | "workflowFile"
    | "label"
    | "path"
    | "home"
    | "stallSeconds"
    | "checkIntervalSeconds"
    | "restartDelaySeconds"
  >,
  runtime: Pick<
    OrchestratorLaunchdRuntimeOptions,
    "env" | "homeDir" | "scriptPath"
  > = {},
): string {
  const workflowPath = resolvePath(repoRoot, options.workflowFile);
  const supervisorScriptPath = resolveLaunchdSupervisorScriptPath(runtime);
  const label = buildOrchestratorLaunchdLabel(
    repoRoot,
    workflow,
    options.label,
  );
  const pathValue = resolveLaunchdPathValue(options, runtime);
  const homePath = resolveLaunchdHome(options, runtime);
  const stdoutPath = getLaunchdStdoutPath(repoRoot, workflow);
  const stderrPath = getLaunchdStderrPath(repoRoot, workflow);
  const programArguments = [
    process.execPath,
    supervisorScriptPath,
    "run",
    "--workflow",
    workflowPath,
    "--stall-seconds",
    String(options.stallSeconds),
    "--check-interval-seconds",
    String(options.checkIntervalSeconds),
    "--restart-delay-seconds",
    String(options.restartDelaySeconds),
  ];

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${xmlEscape(label)}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...programArguments.map(
      (argument) => `    <string>${xmlEscape(argument)}</string>`,
    ),
    `  </array>`,
    `  <key>WorkingDirectory</key>`,
    `  <string>${xmlEscape(repoRoot)}</string>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <dict>`,
    `    <key>SuccessfulExit</key>`,
    `    <false/>`,
    `  </dict>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    `    <key>PATH</key>`,
    `    <string>${xmlEscape(pathValue)}</string>`,
    `    <key>HOME</key>`,
    `    <string>${xmlEscape(homePath)}</string>`,
    `  </dict>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${xmlEscape(stdoutPath)}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${xmlEscape(stderrPath)}</string>`,
    `</dict>`,
    `</plist>`,
  ].join("\n");
}

function defaultRunLaunchctl(args: string[]): LaunchctlCommandResult {
  const result = spawnSync("launchctl", args, {
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error ?? null,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockOwner(lockPath: string): RuntimeLockOwner | null {
  const ownerPath = join(lockPath, "owner.json");
  if (!existsSync(ownerPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(ownerPath, "utf8"),
    ) as Partial<RuntimeLockOwner>;
    return {
      pid:
        typeof parsed.pid === "number" &&
        Number.isInteger(parsed.pid) &&
        parsed.pid > 0
          ? parsed.pid
          : null,
      workflow:
        typeof parsed.workflow === "string" ? parsed.workflow : "unknown",
      workflowPath:
        typeof parsed.workflowPath === "string"
          ? parsed.workflowPath
          : undefined,
      purpose:
        parsed.purpose === "repo" ||
        parsed.purpose === "worker" ||
        parsed.purpose === "supervisor"
          ? parsed.purpose
          : undefined,
      detail:
        typeof parsed.detail === "string"
          ? parsed.detail
          : typeof parsed.taskId === "string"
            ? parsed.taskId
            : null,
      taskId: typeof parsed.taskId === "string" ? parsed.taskId : undefined,
      acquiredAt:
        typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : "",
    };
  } catch {
    return null;
  }
}

function tryRemoveStaleLock(lockPath: string): boolean {
  if (!existsSync(lockPath)) {
    return false;
  }

  const owner = readLockOwner(lockPath);
  if (owner?.pid !== null && owner?.pid !== undefined) {
    if (isProcessAlive(owner.pid)) {
      return false;
    }

    rmSync(lockPath, { recursive: true, force: true });
    return true;
  }

  let staleByAge = false;
  try {
    const stats = statSync(lockPath);
    staleByAge = Date.now() - stats.mtimeMs > STALE_LOCK_MS;
  } catch {
    staleByAge = true;
  }

  if (staleByAge && (!owner || owner.pid === null || owner.pid === undefined)) {
    rmSync(lockPath, { recursive: true, force: true });
    return true;
  }

  return false;
}

function buildLockOwner(
  workflow: WorkflowConfig,
  purpose: "repo" | "worker" | "supervisor",
  detail: string | null,
): RuntimeLockOwner {
  return {
    pid: typeof process.pid === "number" ? process.pid : null,
    workflow: workflow.name,
    workflowPath: workflow.workflowPath,
    purpose,
    detail,
    taskId: purpose === "repo" && detail ? detail : undefined,
    acquiredAt: new Date().toISOString(),
  };
}

function formatLockOwnerSummary(owner: RuntimeLockOwner | null): string {
  if (!owner) {
    return "owner details unavailable";
  }

  const parts: string[] = [];
  if (owner.pid !== null && owner.pid !== undefined) {
    parts.push(`pid ${owner.pid}`);
  }
  if (owner.workflowPath) {
    parts.push(`workflow file ${owner.workflowPath}`);
  }
  const detail = owner.detail ?? owner.taskId;
  if (detail) {
    parts.push(`detail ${detail}`);
  }
  if (owner.acquiredAt) {
    parts.push(`acquired ${owner.acquiredAt}`);
  }
  return parts.join(", ") || "owner details unavailable";
}

function acquireRuntimeLock(
  lockPath: string,
  owner: RuntimeLockOwner,
  options: {
    waitOnConflict: boolean;
    conflictMessage?: (
      owner: RuntimeLockOwner | null,
      lockPath: string,
    ) => string;
  },
): string {
  ensureDirectory(dirname(lockPath));

  while (true) {
    try {
      mkdirSync(lockPath);
      try {
        writeFileSync(
          join(lockPath, "owner.json"),
          JSON.stringify(owner, null, 2) + "\n",
        );
      } catch (writeError) {
        rmSync(lockPath, { recursive: true, force: true });
        throw writeError;
      }
      return lockPath;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw error;
      }
      if (tryRemoveStaleLock(lockPath)) {
        continue;
      }
      if (!options.waitOnConflict) {
        const message =
          options.conflictMessage?.(readLockOwner(lockPath), lockPath) ??
          `Lock already exists at ${lockPath}.`;
        throw new Error(message);
      }
      Bun.sleepSync(LOCK_POLL_MS);
    }
  }
}

function acquireRepoLock(
  repoRoot: string,
  workflow: WorkflowConfig,
  taskId: string,
): string {
  const lockPath = getRepoLockPath(repoRoot, workflow);
  return acquireRuntimeLock(
    lockPath,
    buildLockOwner(workflow, "repo", taskId),
    { waitOnConflict: true },
  );
}

function acquireWorkerLock(repoRoot: string, workflow: WorkflowConfig): string {
  const lockPath = getWorkerLockPath(repoRoot, workflow);
  return acquireRuntimeLock(
    lockPath,
    buildLockOwner(workflow, "worker", "loop"),
    {
      waitOnConflict: false,
      conflictMessage: (owner, currentLockPath) => {
        const displayLockPath =
          relative(repoRoot, currentLockPath) || currentLockPath;
        return `Workflow ${workflow.name} (${workflow.workflowPath}) already has an active worker in this repo clone. Worker lock: ${displayLockPath} (${formatLockOwnerSummary(owner)}). Stop the existing loop or remove the stale lock if that process is gone.`;
      },
    },
  );
}

function formatSupervisorConflictMessage(
  repoRoot: string,
  workflow: WorkflowConfig,
  lockPath: string,
  owner: RuntimeLockOwner | null,
): string {
  const displayLockPath = relative(repoRoot, lockPath) || lockPath;
  return `Workflow ${workflow.name} (${workflow.workflowPath}) already has an active supervisor in this repo clone. Supervisor lock: ${displayLockPath} (${formatLockOwnerSummary(owner)}). Stop the existing supervisor or remove the stale lock if that process is gone.`;
}

function assertSupervisorCanStart(repoRoot: string, workflow: WorkflowConfig) {
  const lockPath = getSupervisorLockPath(repoRoot, workflow);
  if (!existsSync(lockPath)) {
    return;
  }
  if (tryRemoveStaleLock(lockPath)) {
    return;
  }
  throw new Error(
    formatSupervisorConflictMessage(
      repoRoot,
      workflow,
      lockPath,
      readLockOwner(lockPath),
    ),
  );
}

function acquireSupervisorLock(
  repoRoot: string,
  workflow: WorkflowConfig,
): string {
  const lockPath = getSupervisorLockPath(repoRoot, workflow);
  return acquireRuntimeLock(
    lockPath,
    buildLockOwner(workflow, "supervisor", "loop"),
    {
      waitOnConflict: false,
      conflictMessage: (owner, currentLockPath) =>
        formatSupervisorConflictMessage(
          repoRoot,
          workflow,
          currentLockPath,
          owner,
        ),
    },
  );
}

function releaseRuntimeLock(lockPath: string) {
  rmSync(lockPath, { recursive: true, force: true });
}

function loadActionableTasks(repoRoot: string, workflowPath: string) {
  const workflow = loadWorkflow(repoRoot, workflowPath);
  const actionable = loadTasks(repoRoot, workflow.taskSources);
  const dependencies = loadTasks(repoRoot, workflow.dependencySources);
  const taskUniverse = mergeTaskUniverses(actionable, dependencies);
  return { workflow, actionable, taskUniverse };
}

type SupervisorWorkerProcess = {
  child: ReturnType<typeof spawn>;
  startedAt: Date;
  exited: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  error: string | null;
};

function normalizeRuntimePhase(
  value: unknown,
): OrchestratorRuntimePhase | null {
  return value === "starting" ||
    value === "running_task" ||
    value === "integrating_task" ||
    value === "running_review" ||
    value === "integrating_review" ||
    value === "idle" ||
    value === "sleeping" ||
    value === "completed" ||
    value === "error"
    ? value
    : null;
}

function buildEmptySupervisorWorkerSnapshot(
  source: OrchestratorSupervisorWorkerSource,
): OrchestratorSupervisorWorkerSnapshot {
  return {
    pid: null,
    source,
    phase: null,
    activeTaskId: null,
    heartbeatAt: null,
    waitingUntil: null,
    lastNote: null,
    lastError: null,
  };
}

function readSupervisorWorkerSnapshot(
  repoRoot: string,
  workflow: Pick<WorkflowConfig, "stateFile">,
  expectedPid?: number | null,
): OrchestratorSupervisorWorkerSnapshot {
  const statusPath = getRuntimeStatusPath(repoRoot, workflow);
  const heartbeatPath = getRuntimeHeartbeatPath(repoRoot, workflow);
  let sawArtifact = false;

  if (existsSync(statusPath)) {
    sawArtifact = true;
    try {
      const parsed = JSON.parse(
        readFileSync(statusPath, "utf8"),
      ) as Partial<OrchestratorRuntimeStatus>;
      const pid =
        typeof parsed.pid === "number" && parsed.pid > 0 ? parsed.pid : null;
      if (
        expectedPid === undefined ||
        expectedPid === null ||
        pid === expectedPid
      ) {
        return {
          pid,
          source: "status",
          phase: normalizeRuntimePhase(parsed.phase),
          activeTaskId:
            typeof parsed.activeTaskId === "string"
              ? parsed.activeTaskId
              : null,
          heartbeatAt:
            typeof parsed.heartbeatAt === "string" ? parsed.heartbeatAt : null,
          waitingUntil:
            typeof parsed.waitingUntil === "string"
              ? parsed.waitingUntil
              : null,
          lastNote:
            typeof parsed.lastNote === "string" ? parsed.lastNote : null,
          lastError:
            typeof parsed.lastError === "string" ? parsed.lastError : null,
        };
      }
    } catch {
      // Fall back to heartbeat.json when status.json is missing or invalid.
    }
  }

  if (existsSync(heartbeatPath)) {
    sawArtifact = true;
    try {
      const parsed = JSON.parse(
        readFileSync(heartbeatPath, "utf8"),
      ) as Partial<OrchestratorHeartbeat>;
      const pid =
        typeof parsed.pid === "number" && parsed.pid > 0 ? parsed.pid : null;
      if (
        expectedPid === undefined ||
        expectedPid === null ||
        pid === expectedPid
      ) {
        return {
          pid,
          source: "heartbeat",
          phase: normalizeRuntimePhase(parsed.phase),
          activeTaskId:
            typeof parsed.activeTaskId === "string"
              ? parsed.activeTaskId
              : null,
          heartbeatAt:
            typeof parsed.heartbeatAt === "string" ? parsed.heartbeatAt : null,
          waitingUntil: null,
          lastNote:
            typeof parsed.lastNote === "string" ? parsed.lastNote : null,
          lastError:
            typeof parsed.lastError === "string" ? parsed.lastError : null,
        };
      }
    } catch {
      // Return an invalid marker if neither runtime health file is readable.
    }
  }

  return buildEmptySupervisorWorkerSnapshot(
    sawArtifact ? "invalid" : "missing",
  );
}

function loadSupervisorStatus(
  repoRoot: string,
  workflow: Pick<WorkflowConfig, "stateFile">,
): OrchestratorSupervisorStatus | null {
  const statusPath = getSupervisorStatusPath(repoRoot, workflow);
  if (!existsSync(statusPath)) {
    return null;
  }

  try {
    return JSON.parse(
      readFileSync(statusPath, "utf8"),
    ) as OrchestratorSupervisorStatus;
  } catch {
    return null;
  }
}

function saveSupervisorStatus(
  repoRoot: string,
  workflow: Pick<WorkflowConfig, "stateFile">,
  status: OrchestratorSupervisorStatus,
) {
  const runtimeRoot = getRuntimeRoot(repoRoot, workflow);
  const statusPath = getSupervisorStatusPath(repoRoot, workflow);
  ensureDirectory(runtimeRoot);
  writeFileSync(statusPath, JSON.stringify(status, null, 2) + "\n");
}

function buildSupervisorStatus(
  workflow: Pick<WorkflowConfig, "name" | "workflowPath">,
  options: Pick<
    OrchestratorSupervisorCliOptions,
    "stallSeconds" | "checkIntervalSeconds" | "restartDelaySeconds"
  >,
  startedAt: Date,
): OrchestratorSupervisorStatus {
  return {
    workflowName: workflow.name,
    workflowPath: workflow.workflowPath,
    pid: process.pid,
    state: "starting",
    startedAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
    stallSeconds: options.stallSeconds,
    checkIntervalSeconds: options.checkIntervalSeconds,
    restartDelaySeconds: options.restartDelaySeconds,
    restartCount: 0,
    lastRestartAt: null,
    lastRestartReason: null,
    lastWorkerExitCode: null,
    lastWorkerSignal: null,
    worker: {
      pid: null,
      startedAt: null,
      source: "missing",
      phase: null,
      activeTaskId: null,
      heartbeatAt: null,
      waitingUntil: null,
      lastNote: null,
      lastError: null,
    },
  };
}

async function sleepAsync(
  milliseconds: number,
  sleep?: (milliseconds: number) => Promise<void>,
) {
  if (milliseconds <= 0) {
    return;
  }

  if (sleep) {
    await sleep(milliseconds);
    return;
  }

  await Bun.sleep(milliseconds);
}

function sendSignalToProcessTree(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
  sleep?: (milliseconds: number) => Promise<void>,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleepAsync(PROCESS_EXIT_POLL_MS, sleep);
  }
  return !isProcessAlive(pid);
}

async function terminateProcessTree(
  pid: number | null,
  sleep?: (milliseconds: number) => Promise<void>,
) {
  if (!pid || !isProcessAlive(pid)) {
    return;
  }

  sendSignalToProcessTree(pid, "SIGTERM");
  if (await waitForProcessExit(pid, 5000, sleep)) {
    return;
  }

  sendSignalToProcessTree(pid, "SIGKILL");
  await waitForProcessExit(pid, 2000, sleep);
}

function cleanupWorkerLock(repoRoot: string, workflow: WorkflowConfig) {
  tryRemoveStaleLock(getWorkerLockPath(repoRoot, workflow));
}

function startSupervisorWorker(
  repoRoot: string,
  workflowFile: string,
  workerScriptPath: string,
): SupervisorWorkerProcess {
  const stdio =
    process.stdout.isTTY || process.stderr.isTTY ? "inherit" : "ignore";
  const child = spawn(
    process.execPath,
    [workerScriptPath, "--workflow", workflowFile],
    {
      cwd: repoRoot,
      detached: true,
      stdio,
      env: process.env,
    },
  );
  const managed: SupervisorWorkerProcess = {
    child,
    startedAt: new Date(),
    exited: false,
    exitCode: null,
    exitSignal: null,
    error: null,
  };

  child.once("exit", (code, signal) => {
    managed.exited = true;
    managed.exitCode = code;
    managed.exitSignal = signal;
  });
  child.once("error", (error) => {
    managed.exited = true;
    managed.exitCode = 1;
    managed.exitSignal = null;
    managed.error = error instanceof Error ? error.message : String(error);
  });

  return managed;
}

function isWorkerRuntimeStalled(
  worker: SupervisorWorkerProcess,
  snapshot: OrchestratorSupervisorWorkerSnapshot,
  stallMs: number,
  now = new Date(),
) {
  let deadline = worker.startedAt.getTime() + stallMs;
  const heartbeatAt =
    snapshot.heartbeatAt === null
      ? Number.NaN
      : Date.parse(snapshot.heartbeatAt);
  if (Number.isFinite(heartbeatAt)) {
    deadline = Math.max(deadline, heartbeatAt + stallMs);
  }

  if (snapshot.phase === "sleeping" && snapshot.waitingUntil) {
    const waitingUntil = Date.parse(snapshot.waitingUntil);
    if (Number.isFinite(waitingUntil)) {
      deadline = Math.max(deadline, waitingUntil + stallMs);
    }
  }

  return now.getTime() > deadline;
}

function didWorkerFinishAllTasks(
  worker: SupervisorWorkerProcess,
  snapshot: OrchestratorSupervisorWorkerSnapshot,
  completionPhrase: string,
) {
  return (
    worker.exited &&
    worker.exitCode === 0 &&
    (snapshot.phase === "completed" ||
      snapshot.lastNote === completionPhrase ||
      snapshot.lastNote?.endsWith(` ${completionPhrase}`) === true)
  );
}

function formatSupervisorWorkerSummary(
  snapshot: OrchestratorSupervisorWorkerSnapshot,
) {
  const parts = [
    `source=${snapshot.source}`,
    `phase=${snapshot.phase ?? "unknown"}`,
    `task=${snapshot.activeTaskId ?? "none"}`,
  ];
  if (snapshot.heartbeatAt) {
    parts.push(`heartbeatAt=${snapshot.heartbeatAt}`);
  }
  if (snapshot.waitingUntil) {
    parts.push(`waitingUntil=${snapshot.waitingUntil}`);
  }
  return parts.join(", ");
}

function findTaskById(tasks: Task[], taskId: string): Task | null {
  return tasks.find((task) => task.id === taskId) ?? null;
}

function didTaskComplete(taskId: string, lastMessage: string): boolean {
  return lastMessage.includes(`TASK_DONE ${taskId}`);
}

function didTaskBlock(taskId: string, lastMessage: string): boolean {
  return lastMessage.includes(`TASK_BLOCKED ${taskId}`);
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

function getTaskFailureRecord(
  state: Pick<OrchestratorState, "taskFailures">,
  taskId: string,
): OrchestratorTaskFailureRecord | null {
  return state.taskFailures[taskId] ?? null;
}

function clearTaskFailure(
  state: Pick<OrchestratorState, "taskFailures">,
  taskId: string,
) {
  delete state.taskFailures[taskId];
}

function clearTaskWorkspaceStale(
  state: Pick<OrchestratorState, "taskFailures">,
  taskId: string,
) {
  const taskFailure = state.taskFailures[taskId];
  if (!taskFailure) {
    return;
  }

  taskFailure.staleWorkspace = false;
  taskFailure.staleWorkspaceReason = null;
}

function reconcileTaskFailures(
  state: Pick<OrchestratorState, "taskFailures">,
  tasks: Task[],
) {
  const retryableTaskIds = new Set(
    tasks
      .filter(
        (task) => task.status === "pending" || task.status === "in-progress",
      )
      .map((task) => task.id),
  );
  let changed = false;

  for (const taskId of Object.keys(state.taskFailures)) {
    if (retryableTaskIds.has(taskId)) {
      continue;
    }
    delete state.taskFailures[taskId];
    changed = true;
  }

  return changed;
}

function calculateTaskFailureBackoffSeconds(
  workflow: Pick<WorkflowConfig, "taskFailureBackoffSeconds">,
  consecutiveFailures: number,
) {
  if (workflow.taskFailureBackoffSeconds <= 0) {
    return 0;
  }

  return (
    workflow.taskFailureBackoffSeconds *
    Math.pow(2, Math.max(0, consecutiveFailures - 1))
  );
}

function describeTaskFailureKind(kind: TaskFailureKind) {
  if (kind === "agent") {
    return "agent";
  }
  if (kind === "integration") {
    return "integration";
  }
  return "runtime";
}

function buildAgentFailureNote(runResult: AgentRunResult) {
  const summary = summarizeMessage(runResult.lastMessage, "");
  const prefix = runResult.spawnError
    ? `Agent command failed to start: ${runResult.spawnError}.`
    : `Agent command exited ${runResult.exitCode}.`;

  if (!summary) {
    return `${prefix} Command: ${runResult.commandLine}`;
  }

  return `${prefix} Last message: ${summary} Command: ${runResult.commandLine}`;
}

function scheduleTaskRetry(params: {
  taskId: string;
  workflow: Pick<
    WorkflowConfig,
    "taskFailureRetryLimit" | "taskFailureBackoffSeconds"
  >;
  state: Pick<OrchestratorState, "taskFailures">;
  failureKind: TaskFailureKind;
  failureNote: string;
  markWorkspaceStale?: boolean;
  failedAt?: Date;
}): {
  historyStatus: "retry_scheduled" | "retry_exhausted";
  historyNote: string;
} {
  const {
    taskId,
    workflow,
    state,
    failureKind,
    failureNote,
    markWorkspaceStale = false,
    failedAt = new Date(),
  } = params;
  const previousFailure = getTaskFailureRecord(state, taskId);
  const consecutiveFailures = (previousFailure?.consecutiveFailures ?? 0) + 1;
  const canRetry = consecutiveFailures <= workflow.taskFailureRetryLimit;
  const backoffSeconds = canRetry
    ? calculateTaskFailureBackoffSeconds(workflow, consecutiveFailures)
    : 0;
  const nextRetryAt = canRetry
    ? new Date(failedAt.getTime() + backoffSeconds * 1000).toISOString()
    : null;
  const staleWorkspace =
    markWorkspaceStale || previousFailure?.staleWorkspace === true;
  const staleWorkspaceReason = staleWorkspace
    ? markWorkspaceStale
      ? failureNote
      : (previousFailure?.staleWorkspaceReason ?? failureNote)
    : null;

  state.taskFailures[taskId] = {
    consecutiveFailures,
    lastFailureAt: failedAt.toISOString(),
    lastFailureKind: failureKind,
    lastFailureNote: failureNote,
    lastBackoffSeconds: backoffSeconds,
    nextRetryAt,
    staleWorkspace,
    staleWorkspaceReason,
  };

  const failureLabel = describeTaskFailureKind(failureKind);
  const failureCountLabel =
    consecutiveFailures === 1
      ? "1 consecutive failure"
      : `${consecutiveFailures} consecutive failures`;

  if (canRetry) {
    const backoffLabel =
      backoffSeconds > 0
        ? `after ${backoffSeconds}s backoff`
        : "with no backoff";
    const workspaceRefreshNote = staleWorkspace
      ? " The task workspace is marked stale and will refresh from the latest integration branch before rerunning."
      : "";
    return {
      historyStatus: "retry_scheduled",
      historyNote: `${taskId} ${failureLabel} failure scheduled retry ${consecutiveFailures} of ${workflow.taskFailureRetryLimit} at ${nextRetryAt} ${backoffLabel}.${workspaceRefreshNote} ${failureNote}`,
    };
  }

  const workspaceRefreshNote = staleWorkspace
    ? " The task workspace remains marked stale and will refresh from the latest integration branch before the next manual rerun."
    : "";
  return {
    historyStatus: "retry_exhausted",
    historyNote: `${taskId} ${failureLabel} failure exhausted the automatic retry limit (${workflow.taskFailureRetryLimit}) after ${failureCountLabel}. Task remains pending.${workspaceRefreshNote} ${failureNote}`,
  };
}

function isTaskRetryExhausted(
  workflow: Pick<WorkflowConfig, "taskFailureRetryLimit">,
  taskFailure: OrchestratorTaskFailureRecord | null,
) {
  return (
    !!taskFailure &&
    taskFailure.nextRetryAt === null &&
    taskFailure.consecutiveFailures > workflow.taskFailureRetryLimit
  );
}

function isTaskWaitingForRetry(
  taskFailure: OrchestratorTaskFailureRecord | null,
  now = new Date(),
) {
  if (!taskFailure?.nextRetryAt) {
    return false;
  }

  return Date.parse(taskFailure.nextRetryAt) > now.getTime();
}

function filterRetryEligibleTasks(
  tasks: Task[],
  workflow: Pick<WorkflowConfig, "taskFailureRetryLimit">,
  state: Pick<OrchestratorState, "taskFailures">,
  now = new Date(),
) {
  return tasks.filter((task) => {
    if (task.status !== "pending") {
      return true;
    }

    const taskFailure = getTaskFailureRecord(state, task.id);
    return (
      !isTaskRetryExhausted(workflow, taskFailure) &&
      !isTaskWaitingForRetry(taskFailure, now)
    );
  });
}

function findNextRetryAt(
  tasks: Task[],
  state: Pick<OrchestratorState, "taskFailures">,
  now = new Date(),
): string | null {
  let nextRetryAt: string | null = null;
  let nextRetryTimestamp = Number.POSITIVE_INFINITY;

  for (const task of tasks) {
    const taskFailure = getTaskFailureRecord(state, task.id);
    if (!taskFailure?.nextRetryAt) {
      continue;
    }

    const retryTimestamp = Date.parse(taskFailure.nextRetryAt);
    if (
      retryTimestamp <= now.getTime() ||
      retryTimestamp >= nextRetryTimestamp
    ) {
      continue;
    }

    nextRetryAt = taskFailure.nextRetryAt;
    nextRetryTimestamp = retryTimestamp;
  }

  return nextRetryAt;
}

function buildRuntimeRetryStatus(
  workflow: Pick<
    WorkflowConfig,
    "taskFailureRetryLimit" | "taskFailureBackoffSeconds"
  >,
  state: Pick<OrchestratorState, "taskFailures">,
  now = new Date(),
): OrchestratorRuntimeRetryStatus {
  const sortedEntries = Object.entries(state.taskFailures).sort(
    ([leftTaskId], [rightTaskId]) => leftTaskId.localeCompare(rightTaskId),
  );
  const taskFailures = Object.fromEntries(sortedEntries);
  const waitingTaskIds: string[] = [];
  const exhaustedTaskIds: string[] = [];
  let nextRetryAt: string | null = null;
  let nextRetryTimestamp = Number.POSITIVE_INFINITY;

  for (const [taskId, taskFailure] of sortedEntries) {
    if (isTaskWaitingForRetry(taskFailure, now)) {
      waitingTaskIds.push(taskId);
    }

    if (isTaskRetryExhausted(workflow, taskFailure)) {
      exhaustedTaskIds.push(taskId);
    }

    if (!taskFailure.nextRetryAt) {
      continue;
    }

    const retryTimestamp = Date.parse(taskFailure.nextRetryAt);
    if (
      !Number.isFinite(retryTimestamp) ||
      retryTimestamp >= nextRetryTimestamp
    ) {
      continue;
    }

    nextRetryAt = taskFailure.nextRetryAt;
    nextRetryTimestamp = retryTimestamp;
  }

  return {
    limit: workflow.taskFailureRetryLimit,
    baseBackoffSeconds: workflow.taskFailureBackoffSeconds,
    activeFailureCount: sortedEntries.length,
    activeTaskIds: sortedEntries.map(([taskId]) => taskId),
    waitingTaskIds,
    exhaustedTaskIds,
    nextRetryAt,
    taskFailures,
  };
}

export function writeRuntimeHealth(
  repoRoot: string,
  workflow: Pick<
    WorkflowConfig,
    | "name"
    | "workflowPath"
    | "stateFile"
    | "taskFailureRetryLimit"
    | "taskFailureBackoffSeconds"
  >,
  state: Pick<
    OrchestratorState,
    "iteration" | "activeTaskId" | "taskFailures" | "history"
  >,
  update: RuntimeHealthUpdate,
) {
  const now = update.now ?? new Date();
  const heartbeatAt = now.toISOString();
  const activeTaskId =
    update.activeTaskId === undefined
      ? state.activeTaskId
      : update.activeTaskId;
  const lastHistoryStatus =
    state.history.length > 0
      ? (state.history[state.history.length - 1]?.status ?? null)
      : null;
  const heartbeat: OrchestratorHeartbeat = {
    workflowName: workflow.name,
    workflowPath: workflow.workflowPath,
    pid: process.pid,
    phase: update.phase,
    activeTaskId: activeTaskId ?? null,
    iteration: state.iteration,
    heartbeatAt,
    lastNote: update.lastNote ?? null,
    lastError: update.lastError ?? null,
  };
  const status: OrchestratorRuntimeStatus = {
    ...heartbeat,
    waitingUntil: update.waitingUntil ?? null,
    lastHistoryStatus,
    retry: buildRuntimeRetryStatus(workflow, state, now),
  };
  const runtimeRoot = getRuntimeRoot(repoRoot, workflow);
  const statusPath = getRuntimeStatusPath(repoRoot, workflow);
  const heartbeatPath = getRuntimeHeartbeatPath(repoRoot, workflow);

  ensureDirectory(runtimeRoot);
  writeFileSync(statusPath, JSON.stringify(status, null, 2) + "\n");
  writeFileSync(heartbeatPath, JSON.stringify(heartbeat, null, 2) + "\n");
}

function buildIdleNote(
  tasks: Task[],
  workflow: Pick<WorkflowConfig, "taskFailureRetryLimit">,
  state: Pick<OrchestratorState, "taskFailures">,
  now = new Date(),
) {
  const waitingTasks = tasks
    .map((task) => ({
      task,
      taskFailure: getTaskFailureRecord(state, task.id),
    }))
    .filter(
      ({ taskFailure }) =>
        !!taskFailure && isTaskWaitingForRetry(taskFailure, now),
    )
    .sort((left, right) =>
      (left.taskFailure?.nextRetryAt ?? "").localeCompare(
        right.taskFailure?.nextRetryAt ?? "",
      ),
    );
  const exhaustedTasks = tasks
    .map((task) => ({
      task,
      taskFailure: getTaskFailureRecord(state, task.id),
    }))
    .filter(({ taskFailure }) =>
      isTaskRetryExhausted(workflow, taskFailure ?? null),
    );
  const notes = ["No ready tasks."];

  if (waitingTasks.length > 0) {
    const firstWaiting = waitingTasks[0];
    const extraWaiting =
      waitingTasks.length > 1
        ? ` (+${waitingTasks.length - 1} more waiting for retry)`
        : "";
    notes.push(
      `Waiting to retry ${firstWaiting.task.id} at ${firstWaiting.taskFailure?.nextRetryAt}.${extraWaiting}`,
    );
  }

  if (exhaustedTasks.length > 0) {
    const firstExhausted = exhaustedTasks[0];
    const extraExhausted =
      exhaustedTasks.length > 1
        ? ` (+${exhaustedTasks.length - 1} more with automatic retries exhausted)`
        : "";
    notes.push(
      `Automatic retries are exhausted for ${firstExhausted.task.id}.${extraExhausted}`,
    );
  }

  return notes.join(" ");
}

function buildTaskSelectionNote(
  repoRoot: string,
  workspacePath: string,
  task: Task,
  state: Pick<OrchestratorState, "taskFailures">,
) {
  const workspaceLabel = workspacePath === repoRoot ? "." : workspacePath;
  const taskFailure = getTaskFailureRecord(state, task.id);
  if (!taskFailure) {
    return `Selected ${task.id} in ${workspaceLabel}.`;
  }

  const refreshNote = taskFailure.staleWorkspace
    ? " on a refreshed workspace"
    : "";
  return `Retrying ${task.id} in ${workspaceLabel}${refreshNote} after ${taskFailure.consecutiveFailures} consecutive failure${
    taskFailure.consecutiveFailures === 1 ? "" : "s"
  }.`;
}

function findReviewRemediationTasks(beforeTasks: Task[], afterTasks: Task[]) {
  const existingTaskIds = new Set(beforeTasks.map((task) => task.id));
  return afterTasks.filter((task) => !existingTaskIds.has(task.id));
}

function validateReviewRemediationTasks(
  reviewId: string,
  reviewedTaskIds: string[],
  afterTasks: Task[],
  remediationTasks: Task[],
) {
  const expectedPrefix = getReviewRemediationTaskIdPrefix(reviewId);
  const reviewedTaskIdSet = new Set(reviewedTaskIds);
  const remediationTaskIds = new Set(remediationTasks.map((task) => task.id));

  for (const task of remediationTasks) {
    const suffix = task.id.slice(expectedPrefix.length);
    if (!task.id.startsWith(expectedPrefix) || !/^\d+$/.test(suffix)) {
      throw new Error(
        `${reviewId} created remediation task ${task.id} with an invalid ID. Review-created tasks must use IDs like ${expectedPrefix}01.`,
      );
    }

    if (task.status !== "pending") {
      throw new Error(
        `${reviewId} created remediation task ${task.id} with status ${task.status}. Review-created tasks must start as pending.`,
      );
    }

    if (task.priority !== "P0") {
      throw new Error(
        `${reviewId} created remediation task ${task.id} with priority ${task.priority}. Review-created tasks must use Priority P0.`,
      );
    }

    if (task.dependsOn.length === 0) {
      throw new Error(
        `${reviewId} created remediation task ${task.id} without reviewed-task dependencies. Review-created tasks must depend on one or more reviewed task IDs.`,
      );
    }

    const invalidDependency = task.dependsOn.find(
      (dependencyId) => !reviewedTaskIdSet.has(dependencyId),
    );
    if (invalidDependency) {
      throw new Error(
        `${reviewId} created remediation task ${task.id} with dependency ${invalidDependency}. Review-created tasks may depend only on reviewed task IDs: ${reviewedTaskIds.join(", ")}.`,
      );
    }
  }

  for (const filePath of new Set(
    remediationTasks.map((task) => task.filePath),
  )) {
    const fileTasks = afterTasks.filter((task) => task.filePath === filePath);
    let seenRemediationTask = false;

    for (const task of fileTasks) {
      const isRemediationTask = remediationTaskIds.has(task.id);
      if (isRemediationTask) {
        seenRemediationTask = true;
        continue;
      }

      if (seenRemediationTask) {
        throw new Error(
          `${reviewId} inserted remediation tasks into ${filePath} before existing tasks. Review-created tasks must be appended as a contiguous block at the end of the task doc.`,
        );
      }
    }
  }
}

function integrateReviewPass(params: {
  repoRoot: string;
  workflow: WorkflowConfig;
  reviewId: string;
  reviewedTaskIds: string[];
  workspace: WorkspaceHandle;
  state: OrchestratorState;
}): {
  historyNote: string;
  refreshedActionableTasks: Task[];
  commitSha: string | null;
} {
  const { repoRoot, workflow, reviewId, reviewedTaskIds, workspace, state } =
    params;
  const integrationBranch =
    workflow.requiredBranch ?? getCurrentBranch(repoRoot);
  if (!integrationBranch) {
    throw new Error(
      "Could not determine the integration branch for review integration.",
    );
  }

  const reviewSummary = `Reviewed ${reviewedTaskIds.join(", ")}`;
  const commitResult = commitPendingChanges(
    workspace.path,
    `orchestrator: review ${reviewId} ${reviewSummary}`,
  );
  if (commitResult.error) {
    throw new Error(
      `${reviewId} auto-commit failed in review workspace: ${commitResult.error}`,
    );
  }

  if (
    workspace.kind === "shared" &&
    getCurrentBranch(workspace.path) === integrationBranch
  ) {
    const refreshedActionableTasks = loadTasks(repoRoot, workflow.taskSources);
    let historyNote = commitResult.committed
      ? `${reviewId} reviewed ${reviewedTaskIds.length} task${
          reviewedTaskIds.length === 1 ? "" : "s"
        } and committed directly on ${integrationBranch}${
          commitResult.commitSha ? ` as ${commitResult.commitSha}` : ""
        }.`
      : `${reviewId} reviewed ${reviewedTaskIds.length} task${
          reviewedTaskIds.length === 1 ? "" : "s"
        }; no repo changes were needed.`;

    if (commitResult.committed) {
      state.commitsSincePush += 1;
      state.lastCommittedTaskId = reviewId;
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

    return {
      historyNote,
      refreshedActionableTasks,
      commitSha: commitResult.commitSha,
    };
  }

  const lockPath = acquireRepoLock(repoRoot, workflow, reviewId);
  try {
    const uniqueCommits = listUniqueCommits(workspace.path, integrationBranch);
    if (uniqueCommits.length === 0) {
      return {
        historyNote: `${reviewId} reviewed ${reviewedTaskIds.length} task${
          reviewedTaskIds.length === 1 ? "" : "s"
        }; no new commits were needed on ${integrationBranch}.`,
        refreshedActionableTasks: loadTasks(repoRoot, workflow.taskSources),
        commitSha: null,
      };
    }

    if (workspace.kind === "git_worktree") {
      assertCleanIntegrationCheckout(repoRoot, integrationBranch, reviewId);
    }

    const cherryPickResult = cherryPickCommits(repoRoot, uniqueCommits);
    if (cherryPickResult.error) {
      throw new Error(
        `${reviewId} integration failed: ${cherryPickResult.error}`,
      );
    }

    state.commitsSincePush += cherryPickResult.commitCount;
    state.lastCommittedTaskId = reviewId;
    state.lastCommitSha = cherryPickResult.lastCommitSha;

    const refreshedActionableTasks = loadTasks(repoRoot, workflow.taskSources);
    let historyNote = `${reviewId} reviewed ${reviewedTaskIds.length} task${
      reviewedTaskIds.length === 1 ? "" : "s"
    } and integrated ${cherryPickResult.commitCount} commit${
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

    return {
      historyNote,
      refreshedActionableTasks,
      commitSha: cherryPickResult.lastCommitSha,
    };
  } finally {
    releaseRuntimeLock(lockPath);
  }
}

function executeReviewPass(params: {
  repoRoot: string;
  workflow: WorkflowConfig;
  actionableTasks: Task[];
  state: OrchestratorState;
  dryRun: boolean;
  log: (message: string) => void;
  reportRuntimeHealth: (update: RuntimeHealthUpdate) => void;
}): {
  refreshedActionableTasks: Task[];
  stopAfterIteration: boolean;
  errorMessage: string | null;
} {
  const {
    repoRoot,
    workflow,
    actionableTasks,
    state,
    dryRun,
    log,
    reportRuntimeHealth,
  } = params;
  const reviewedTasks = getReviewTaskContexts(
    repoRoot,
    workflow,
    actionableTasks,
    state,
  );
  if (reviewedTasks.length === 0) {
    return {
      refreshedActionableTasks: actionableTasks,
      stopAfterIteration: false,
      errorMessage: null,
    };
  }

  const reviewId = `review-${String(state.reviews.length + 1).padStart(3, "0")}`;
  const reviewTask = createReviewTask(reviewId, workflow, reviewedTasks);
  const workspacePreview = previewWorkspacePath(repoRoot, workflow, reviewTask);
  const prompt = buildReviewPrompt(
    workflow,
    reviewId,
    reviewedTasks,
    workspacePreview,
  );

  log(
    `\n=== Iteration ${state.iteration + (dryRun ? 0 : 1)}: ${reviewId} periodic review ===`,
  );
  log(`Workspace: ${workspacePreview}`);

  if (dryRun) {
    log("Dry run selected review summary:");
    log(`- Review: ${reviewId}`);
    log(
      `- Reviewed tasks: ${reviewedTasks.map((entry) => entry.task.id).join(", ")}`,
    );
    log(
      `- Prompt preview: ${prompt.slice(0, 400)}${prompt.length > 400 ? "..." : ""}`,
    );
    reportRuntimeHealth({
      phase: "idle",
      activeTaskId: reviewId,
      lastNote: `Dry run selected ${reviewId}.`,
    });
    return {
      refreshedActionableTasks: actionableTasks,
      stopAfterIteration: false,
      errorMessage: null,
    };
  }

  state.iteration += 1;
  const reviewStartNote = `Reviewing ${reviewedTasks
    .map((entry) => entry.task.id)
    .join(", ")} in ${workspacePreview === repoRoot ? "." : workspacePreview}.`;
  appendProgress(repoRoot, workflow, [
    formatHistoryNote(reviewId, "review_started", reviewStartNote),
  ]);
  state.history.push({
    iteration: state.iteration,
    taskId: reviewId,
    timestamp: new Date().toISOString(),
    status: "review_started",
    note: reviewStartNote,
  });
  saveState(repoRoot, workflow, state);
  reportRuntimeHealth({
    phase: "running_review",
    activeTaskId: reviewId,
    lastNote: reviewStartNote,
  });

  try {
    const workspace = ensureWorkspace(repoRoot, workflow, reviewTask);
    const runResult = runAgentForReview(
      repoRoot,
      workflow,
      reviewId,
      workspace.path,
      buildReviewPrompt(workflow, reviewId, reviewedTasks, workspace.path),
      reviewedTasks.map((entry) => entry.task.id),
    );

    if (runResult.exitCode !== 0) {
      const historyNote = `Review command failed: ${runResult.commandLine}`;
      appendProgress(repoRoot, workflow, [
        formatHistoryNote(reviewId, "review_error", historyNote),
      ]);
      state.history.push({
        iteration: state.iteration,
        taskId: reviewId,
        timestamp: new Date().toISOString(),
        status: "review_error",
        note: historyNote,
      });
      saveState(repoRoot, workflow, state);
      reportRuntimeHealth({
        phase: "error",
        activeTaskId: reviewId,
        lastError: historyNote,
      });
      return {
        refreshedActionableTasks: actionableTasks,
        stopAfterIteration: true,
        errorMessage: historyNote,
      };
    }

    const reviewWorkspaceTasks = loadTasks(
      workspace.path,
      workflow.taskSources,
    );
    const remediationTasks = findReviewRemediationTasks(
      actionableTasks,
      reviewWorkspaceTasks,
    );
    validateReviewRemediationTasks(
      reviewId,
      reviewedTasks.map((entry) => entry.task.id),
      reviewWorkspaceTasks,
      remediationTasks,
    );
    const reviewedAt = new Date().toISOString();
    const summary = summarizeMessage(
      runResult.lastMessage,
      `REVIEW_DONE: Reviewed ${reviewedTasks
        .map((entry) => entry.task.id)
        .join(", ")}.`,
    );
    appendReviewOutcome({
      repoPath: workspace.path,
      displayRoot: repoRoot,
      workflow,
      reviewId,
      reviewedAt,
      reviewTasks: reviewedTasks,
      remediationTasks,
      summary,
      lastMessagePath: runResult.lastMessagePath,
    });

    reportRuntimeHealth({
      phase: "integrating_review",
      activeTaskId: reviewId,
      lastNote: `Integrating ${reviewId}.`,
    });
    const integrationResult = integrateReviewPass({
      repoRoot,
      workflow,
      reviewId,
      reviewedTaskIds: reviewedTasks.map((entry) => entry.task.id),
      workspace,
      state,
    });

    state.lastReviewedCompletionCount += reviewedTasks.length;

    const remediationTaskIds = remediationTasks.map((task) => task.id);
    const remediationNote =
      remediationTaskIds.length > 0
        ? `Created remediation tasks: ${remediationTaskIds.join(", ")}.`
        : "No remediation tasks created.";
    const historyNote = `${integrationResult.historyNote} ${remediationNote} ${summary}`;

    state.reviews.push({
      id: reviewId,
      iteration: state.iteration,
      timestamp: reviewedAt,
      reviewedTaskIds: reviewedTasks.map((entry) => entry.task.id),
      remediationTaskIds,
      lastMessageFile: relative(repoRoot, runResult.lastMessagePath),
      commitSha: integrationResult.commitSha,
      note: historyNote,
    });
    appendProgress(repoRoot, workflow, [
      formatHistoryNote(reviewId, "review_completed", historyNote),
    ]);
    state.history.push({
      iteration: state.iteration,
      taskId: reviewId,
      timestamp: new Date().toISOString(),
      status: "review_completed",
      note: historyNote,
    });
    saveState(repoRoot, workflow, state);
    reportRuntimeHealth({
      phase: "idle",
      activeTaskId: null,
      lastNote: historyNote,
    });

    return {
      refreshedActionableTasks: integrationResult.refreshedActionableTasks,
      stopAfterIteration: false,
      errorMessage: null,
    };
  } catch (caughtError) {
    const historyNote =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    appendProgress(repoRoot, workflow, [
      formatHistoryNote(reviewId, "review_error", historyNote),
    ]);
    state.history.push({
      iteration: state.iteration,
      taskId: reviewId,
      timestamp: new Date().toISOString(),
      status: "review_error",
      note: historyNote,
    });
    saveState(repoRoot, workflow, state);
    reportRuntimeHealth({
      phase: "error",
      activeTaskId: reviewId,
      lastError: historyNote,
    });
    return {
      refreshedActionableTasks: actionableTasks,
      stopAfterIteration: true,
      errorMessage: historyNote,
    };
  }
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

  const rootTask = findTaskById(rootActionableTasks, task.id) ?? task;
  const desiredStatus: TaskStatus =
    terminalStatus === "completed" ? "done" : "blocked";
  const workspace = ensureWorkspace(repoRoot, workflow, task);
  restoreTaskStatusMetadata(workspace.path, rootTask, task.status);
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
    const trackerCommitResult = recordTerminalTaskStatusOnIntegrationBranch({
      repoRoot,
      task: rootTask,
      terminalStatus,
      commitMessage,
      amendExistingCommit: commitResult.committed,
    });
    if (trackerCommitResult.error) {
      throw new Error(
        `${task.id} could not update root task status on ${integrationBranch}: ${trackerCommitResult.error}`,
      );
    }

    const refreshedActionableTasks = loadTasks(repoRoot, workflow.taskSources);
    const refreshedTask = findTaskById(refreshedActionableTasks, task.id);
    const terminalLabel =
      terminalStatus === "completed" ? "completed" : "blocked";
    const finalCommitSha =
      trackerCommitResult.commitSha ?? commitResult.commitSha;
    const committedDirectly =
      commitResult.committed || trackerCommitResult.committed;

    if (refreshedTask?.status !== desiredStatus) {
      throw new Error(
        `${task.id} committed directly on ${integrationBranch} but root task status is not ${desiredStatus}.`,
      );
    }

    let historyNote = committedDirectly
      ? `${task.id} ${terminalLabel} and committed directly on ${integrationBranch}${
          finalCommitSha ? ` as ${finalCommitSha}` : ""
        }.`
      : `${task.id} already reflected on ${integrationBranch}; no direct commit needed.`;

    if (committedDirectly) {
      state.commitsSincePush += 1;
      state.lastCommittedTaskId = task.id;
      state.lastCommitSha = finalCommitSha;
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
      if (rootTask.status === desiredStatus) {
        return {
          historyNote: `${task.id} already reflected on ${integrationBranch}; no new commits to integrate.`,
          refreshedActionableTasks: rootActionableTasks,
        };
      }

      if (workspace.kind === "git_worktree") {
        assertCleanIntegrationCheckout(repoRoot, integrationBranch, task.id);
      }

      const trackerCommitResult = recordTerminalTaskStatusOnIntegrationBranch({
        repoRoot,
        task: rootTask,
        terminalStatus,
        commitMessage,
        amendExistingCommit: false,
      });
      if (trackerCommitResult.error) {
        throw new Error(
          `${task.id} could not update root task status on ${integrationBranch}: ${trackerCommitResult.error}`,
        );
      }

      const refreshedActionableTasks = loadTasks(
        repoRoot,
        workflow.taskSources,
      );
      const refreshedTask = findTaskById(refreshedActionableTasks, task.id);
      if (refreshedTask?.status !== desiredStatus) {
        throw new Error(
          `${task.id} recorded directly on ${integrationBranch} but root task status is not ${desiredStatus}.`,
        );
      }

      if (trackerCommitResult.committed) {
        state.commitsSincePush += 1;
        state.lastCommittedTaskId = task.id;
        state.lastCommitSha = trackerCommitResult.commitSha;
      }

      const terminalLabel =
        terminalStatus === "completed" ? "completed" : "blocked";
      let historyNote = trackerCommitResult.committed
        ? `${task.id} ${terminalLabel} and updated ${integrationBranch}${
            trackerCommitResult.commitSha
              ? ` as ${trackerCommitResult.commitSha}`
              : ""
          }.`
        : `${task.id} already reflected on ${integrationBranch}; no new commits to integrate.`;

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
          throw new Error(
            `${historyNote} Auto-push failed: ${pushResult.error}`,
          );
        }
        state.commitsSincePush = 0;
        historyNote = `${historyNote} Pushed ${integrationBranch}.`;
      }

      return {
        historyNote,
        refreshedActionableTasks,
      };
    }

    if (workspace.kind === "git_worktree") {
      assertCleanIntegrationCheckout(repoRoot, integrationBranch, task.id);
    }

    const cherryPickResult = cherryPickCommits(repoRoot, uniqueCommits);
    if (cherryPickResult.error) {
      if (cherryPickResult.contentConflict) {
        throw new WorkspaceRefreshRequiredError(
          `${task.id} integration hit a cherry-pick content conflict against ${integrationBranch}. Rebuild the task workspace from the latest ${integrationBranch} before rerunning. ${cherryPickResult.error}`,
        );
      }
      throw new Error(
        `${task.id} integration failed: ${cherryPickResult.error}`,
      );
    }

    const trackerCommitResult = recordTerminalTaskStatusOnIntegrationBranch({
      repoRoot,
      task: rootTask,
      terminalStatus,
      commitMessage,
      amendExistingCommit: true,
    });
    if (trackerCommitResult.error) {
      throw new Error(
        `${task.id} could not update root task status on ${integrationBranch}: ${trackerCommitResult.error}`,
      );
    }

    state.commitsSincePush += cherryPickResult.commitCount;
    state.lastCommittedTaskId = task.id;
    state.lastCommitSha =
      trackerCommitResult.commitSha ?? cherryPickResult.lastCommitSha;

    const refreshedActionableTasks = loadTasks(repoRoot, workflow.taskSources);
    const refreshedTask = findTaskById(refreshedActionableTasks, task.id);
    const terminalLabel =
      terminalStatus === "completed" ? "completed" : "blocked";
    let historyNote = `${task.id} ${terminalLabel} and integrated ${cherryPickResult.commitCount} commit${
      cherryPickResult.commitCount === 1 ? "" : "s"
    }${state.lastCommitSha ? ` as ${state.lastCommitSha}` : ""}.`;

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

    if (refreshedTask?.status !== desiredStatus) {
      throw new Error(
        `${task.id} integrated successfully but root task status is not ${desiredStatus}.`,
      );
    }

    return { historyNote, refreshedActionableTasks };
  } finally {
    releaseRuntimeLock(lockPath);
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

  const workerLockPath = acquireWorkerLock(repoRoot, workflow);

  try {
    const state = loadState(repoRoot, workflow);
    const maxIterations = options.maxIterations ?? workflow.maxIterations;
    const reportRuntimeHealth = (update: RuntimeHealthUpdate) =>
      writeRuntimeHealth(repoRoot, workflow, state, update);
    const reportRuntimeError = (
      message: string,
      activeTaskId = state.activeTaskId,
    ) =>
      reportRuntimeHealth({
        phase: "error",
        activeTaskId,
        lastError: message,
      });

    reportRuntimeHealth({
      phase: "starting",
      activeTaskId: state.activeTaskId,
      lastNote: `Worker ${process.pid} started ${workflow.name}.`,
    });

    try {
      for (let loop = 0; loop < maxIterations; loop += 1) {
        const { actionable, taskUniverse } = loadActionableTasks(
          repoRoot,
          options.workflowFile,
        );
        if (reconcileTaskFailures(state, actionable)) {
          saveState(repoRoot, workflow, state);
        }
        const now = new Date();
        const retryEligibleActionable = filterRetryEligibleTasks(
          actionable,
          workflow,
          state,
          now,
        );

        if (shouldRunReview(workflow, state, actionable)) {
          const reviewResult = executeReviewPass({
            repoRoot,
            workflow,
            actionableTasks: actionable,
            state,
            dryRun: options.dryRun,
            log,
            reportRuntimeHealth,
          });

          if (reviewResult.stopAfterIteration) {
            error(reviewResult.errorMessage ?? "Review pass failed.");
            return 1;
          }

          if (options.once || options.dryRun) {
            return 0;
          }

          continue;
        }

        const task = selectNextTask(
          retryEligibleActionable,
          state.activeTaskId,
          taskUniverse,
        );

        if (!task) {
          state.activeTaskId = null;
          const idleNote = buildIdleNote(actionable, workflow, state, now);
          appendProgress(repoRoot, workflow, [
            formatHistoryNote(null, "idle", idleNote),
          ]);
          saveState(repoRoot, workflow, state);

          if (areAllTasksComplete(actionable)) {
            const integrationBranch =
              workflow.requiredBranch ?? getCurrentBranch(repoRoot);
            if (
              integrationBranch &&
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
                const errorMessage = `Final auto-push failed: ${pushResult.error}`;
                reportRuntimeError(errorMessage, null);
                error(errorMessage);
                return 1;
              }
              state.commitsSincePush = 0;
              saveState(repoRoot, workflow, state);
            }
            reportRuntimeHealth({
              phase: "completed",
              activeTaskId: null,
              lastNote: `All tracked tasks are complete. ${workflow.completionPhrase}`,
            });
            log(workflow.completionPhrase);
            return 0;
          }

          if (options.once) {
            reportRuntimeHealth({
              phase: "idle",
              activeTaskId: null,
              lastNote: idleNote,
            });
            return 0;
          }

          const pollWaitMs = workflow.pollIntervalSeconds * 1000;
          const nextRetryAt = findNextRetryAt(actionable, state, now);
          const nextRetryWaitMs =
            nextRetryAt === null
              ? null
              : Math.max(0, Date.parse(nextRetryAt) - now.getTime());
          const waitMs =
            nextRetryWaitMs === null
              ? pollWaitMs
              : pollWaitMs > 0
                ? Math.min(pollWaitMs, nextRetryWaitMs)
                : nextRetryWaitMs;
          reportRuntimeHealth({
            phase: waitMs > 0 ? "sleeping" : "idle",
            activeTaskId: null,
            lastNote: idleNote,
            waitingUntil:
              waitMs > 0
                ? new Date(now.getTime() + waitMs).toISOString()
                : null,
          });
          if (waitMs > 0) {
            sleep(waitMs);
          }
          continue;
        }

        const workspacePreview = previewWorkspacePath(repoRoot, workflow, task);
        const prompt = buildTaskPrompt(workflow, task, workspacePreview);
        const taskSelectionNote = buildTaskSelectionNote(
          repoRoot,
          workspacePreview,
          task,
          state,
        );

        state.iteration += 1;
        state.activeTaskId = task.id;
        appendProgress(repoRoot, workflow, [
          formatHistoryNote(
            task.id,
            task.id === state.lastCommittedTaskId ? "continued" : "started",
            taskSelectionNote,
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
          reportRuntimeHealth({
            phase: "idle",
            activeTaskId: task.id,
            lastNote: `Dry run selected ${task.id}.`,
          });
          return 0;
        }

        reportRuntimeHealth({
          phase: "running_task",
          activeTaskId: task.id,
          lastNote: taskSelectionNote,
        });

        let refreshedActionableTasks = actionable;
        let historyStatus:
          | "completed"
          | "blocked"
          | "continued"
          | "retry_scheduled"
          | "retry_exhausted" = "continued";
        let historyNote = `${task.id} remains active.`;
        let taskFailureKind: TaskFailureKind = "runtime";

        try {
          const workspace = ensureTaskWorkspace(
            repoRoot,
            workflow,
            task,
            state,
          );
          taskFailureKind = "agent";
          const runResult = runAgentForTask(
            repoRoot,
            workflow,
            task,
            workspace.path,
            buildTaskPrompt(workflow, task, workspace.path),
          );
          taskFailureKind = "runtime";
          const workspaceActionableTasks = loadTasks(
            workspace.path,
            workflow.taskSources,
          );
          const rootTask = findTaskById(actionable, task.id) ?? task;
          const workspaceTask =
            findTaskById(workspaceActionableTasks, task.id) ?? rootTask;
          restoreTaskStatusMetadata(
            workspace.path,
            rootTask,
            workspaceTask.status,
          );

          if (didTaskBlock(task.id, runResult.lastMessage)) {
            historyStatus = "blocked";
            state.activeTaskId = null;
            reportRuntimeHealth({
              phase: "integrating_task",
              activeTaskId: task.id,
              lastNote: `Recording blocked outcome for ${task.id}.`,
            });
            taskFailureKind = "integration";
            const integrationResult = integrateTerminalTask({
              repoRoot,
              workflow,
              task: workspaceTask,
              terminalStatus: "blocked",
              rootActionableTasks: actionable,
              state,
            });
            refreshedActionableTasks =
              integrationResult.refreshedActionableTasks;
            clearTaskFailure(state, task.id);
            historyNote = extractBlockedReason(task.id, runResult.lastMessage);
            if (integrationResult.historyNote) {
              historyNote = `${historyNote} ${integrationResult.historyNote}`;
            }
          } else if (runResult.exitCode !== 0) {
            state.activeTaskId = null;
            const retryResult = scheduleTaskRetry({
              taskId: task.id,
              workflow,
              state,
              failureKind: "agent",
              failureNote: buildAgentFailureNote(runResult),
            });
            historyStatus = retryResult.historyStatus;
            historyNote = retryResult.historyNote;
          } else if (didTaskComplete(task.id, runResult.lastMessage)) {
            historyStatus = "completed";
            state.activeTaskId = null;
            reportRuntimeHealth({
              phase: "integrating_task",
              activeTaskId: task.id,
              lastNote: `Integrating completed outcome for ${task.id}.`,
            });
            taskFailureKind = "integration";
            const integrationResult = integrateTerminalTask({
              repoRoot,
              workflow,
              task: workspaceTask,
              terminalStatus: "completed",
              rootActionableTasks: actionable,
              state,
            });
            refreshedActionableTasks =
              integrationResult.refreshedActionableTasks;
            clearTaskFailure(state, task.id);
            historyNote = integrationResult.historyNote;
          } else {
            historyStatus = "continued";
            historyNote = `${task.id} remains active.`;
            state.activeTaskId = task.id;
            clearTaskFailure(state, task.id);
          }
        } catch (caughtError) {
          state.activeTaskId = null;
          const failureNote =
            caughtError instanceof Error
              ? caughtError.message
              : String(caughtError);
          const retryResult = scheduleTaskRetry({
            taskId: task.id,
            workflow,
            state,
            failureKind: taskFailureKind,
            failureNote,
            markWorkspaceStale:
              caughtError instanceof WorkspaceRefreshRequiredError,
          });
          historyStatus = retryResult.historyStatus;
          historyNote = retryResult.historyNote;
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

        if (shouldRunReview(workflow, state, refreshedActionableTasks)) {
          const reviewResult = executeReviewPass({
            repoRoot,
            workflow,
            actionableTasks: refreshedActionableTasks,
            state,
            dryRun: false,
            log,
            reportRuntimeHealth,
          });

          if (reviewResult.stopAfterIteration) {
            error(reviewResult.errorMessage ?? "Review pass failed.");
            return 1;
          }

          refreshedActionableTasks = reviewResult.refreshedActionableTasks;
        }

        if (areAllTasksComplete(refreshedActionableTasks)) {
          const integrationBranch =
            workflow.requiredBranch ?? getCurrentBranch(repoRoot);
          if (
            integrationBranch &&
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
              const errorMessage = `Final auto-push failed: ${pushResult.error}`;
              reportRuntimeError(errorMessage, null);
              error(errorMessage);
              return 1;
            }
            state.commitsSincePush = 0;
            saveState(repoRoot, workflow, state);
          }
          reportRuntimeHealth({
            phase: "completed",
            activeTaskId: null,
            lastNote: `All tracked tasks are complete. ${workflow.completionPhrase}`,
          });
          log(workflow.completionPhrase);
          return 0;
        }

        const runtimeMessage =
          historyStatus === "retry_scheduled" ||
          historyStatus === "retry_exhausted"
            ? { lastNote: null, lastError: historyNote }
            : { lastNote: historyNote, lastError: null };

        if (options.once) {
          reportRuntimeHealth({
            phase: "idle",
            activeTaskId: state.activeTaskId,
            ...runtimeMessage,
          });
          return 0;
        }

        const waitMs = workflow.pollIntervalSeconds * 1000;
        reportRuntimeHealth({
          phase: waitMs > 0 ? "sleeping" : "idle",
          activeTaskId: state.activeTaskId,
          waitingUntil:
            waitMs > 0 ? new Date(Date.now() + waitMs).toISOString() : null,
          ...runtimeMessage,
        });
        if (waitMs > 0) {
          sleep(waitMs);
        }
      }
    } catch (caughtError) {
      reportRuntimeError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      );
      throw caughtError;
    }

    const maxIterationNote = `Reached max iterations without seeing ${workflow.completionPhrase}.`;
    reportRuntimeHealth({
      phase: "idle",
      activeTaskId: state.activeTaskId,
      lastNote: maxIterationNote,
    });
    log(maxIterationNote);
    return 0;
  } finally {
    releaseRuntimeLock(workerLockPath);
  }
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

async function runOrchestratorSupervisor(
  options: OrchestratorSupervisorCliOptions,
  runtime: OrchestratorSupervisorRuntimeOptions = {},
): Promise<number> {
  const log = runtime.log ?? ((message: string) => console.log(message));
  const error = runtime.error ?? ((message: string) => console.error(message));
  const repoRoot = runtime.repoRoot ? resolve(runtime.repoRoot) : process.cwd();
  const workflow = loadWorkflow(repoRoot, options.workflowFile);
  const supervisorScriptPath = resolve(
    runtime.scriptPath ??
      process.argv[1] ??
      "scripts/orchestrator-supervisor.ts",
  );
  const workerScriptPath = resolve(
    dirname(supervisorScriptPath),
    "orchestrator.ts",
  );
  const supervisorStartedAt = new Date();
  const supervisorLockPath = acquireSupervisorLock(repoRoot, workflow);
  const supervisorStatus = buildSupervisorStatus(
    workflow,
    options,
    supervisorStartedAt,
  );
  const checkIntervalMs = options.checkIntervalSeconds * 1000;
  const stallMs = options.stallSeconds * 1000;
  const restartDelayMs = options.restartDelaySeconds * 1000;
  let currentState: OrchestratorSupervisorState = "starting";
  let worker: SupervisorWorkerProcess | null = null;
  let workerSnapshot = buildEmptySupervisorWorkerSnapshot("missing");
  let stopping = false;
  let completed = false;

  const persistSupervisorStatus = () => {
    supervisorStatus.state = currentState;
    supervisorStatus.updatedAt = new Date().toISOString();
    supervisorStatus.worker = {
      pid:
        worker && !worker.exited
          ? (worker.child.pid ?? null)
          : (workerSnapshot.pid ?? null),
      startedAt:
        worker && !worker.exited ? worker.startedAt.toISOString() : null,
      source: workerSnapshot.source,
      phase: workerSnapshot.phase,
      activeTaskId: workerSnapshot.activeTaskId,
      heartbeatAt: workerSnapshot.heartbeatAt,
      waitingUntil: workerSnapshot.waitingUntil,
      lastNote: workerSnapshot.lastNote,
      lastError: workerSnapshot.lastError,
    };
    saveSupervisorStatus(repoRoot, workflow, supervisorStatus);
  };

  const restartWorker = async (reason: string) => {
    if (restartDelayMs > 0) {
      currentState = "restarting";
      persistSupervisorStatus();
      await sleepAsync(restartDelayMs, runtime.sleep);
    }

    if (stopping) {
      return;
    }

    supervisorStatus.restartCount += 1;
    supervisorStatus.lastRestartAt = new Date().toISOString();
    supervisorStatus.lastRestartReason = reason;
    worker = startSupervisorWorker(
      repoRoot,
      options.workflowFile,
      workerScriptPath,
    );
    workerSnapshot = buildEmptySupervisorWorkerSnapshot("missing");
    currentState = "running";
    persistSupervisorStatus();
    log(
      `Restarted ${workflow.name} worker after ${reason} (pid ${worker.child.pid ?? "unknown"}).`,
    );
  };

  const handleStopSignal = (signal: NodeJS.Signals) => {
    if (stopping) {
      return;
    }

    stopping = true;
    currentState = "stopping";
    workerSnapshot = readSupervisorWorkerSnapshot(
      repoRoot,
      workflow,
      worker?.child.pid ?? null,
    );
    persistSupervisorStatus();
    if (worker?.child.pid) {
      sendSignalToProcessTree(worker.child.pid, signal);
    }
  };

  const signalHandlers: Array<[NodeJS.Signals, () => void]> = [
    ["SIGINT", () => handleStopSignal("SIGINT")],
    ["SIGTERM", () => handleStopSignal("SIGTERM")],
    ["SIGHUP", () => handleStopSignal("SIGHUP")],
  ];

  for (const [signal, handler] of signalHandlers) {
    process.on(signal, handler);
  }

  try {
    worker = startSupervisorWorker(
      repoRoot,
      options.workflowFile,
      workerScriptPath,
    );
    currentState = "running";
    persistSupervisorStatus();
    log(
      `Supervising ${workflow.name} (${workflow.workflowPath}). Worker pid ${worker.child.pid ?? "unknown"}.`,
    );

    while (!stopping) {
      workerSnapshot = readSupervisorWorkerSnapshot(
        repoRoot,
        workflow,
        worker?.child.pid ?? null,
      );
      persistSupervisorStatus();

      if (worker && worker.exited) {
        supervisorStatus.lastWorkerExitCode = worker.exitCode;
        supervisorStatus.lastWorkerSignal = worker.exitSignal;
        cleanupWorkerLock(repoRoot, workflow);
        const finalSnapshot = readSupervisorWorkerSnapshot(repoRoot, workflow);
        if (
          finalSnapshot.source !== "missing" &&
          finalSnapshot.source !== "invalid"
        ) {
          workerSnapshot = finalSnapshot;
        }

        if (
          didWorkerFinishAllTasks(
            worker,
            workerSnapshot,
            workflow.completionPhrase,
          )
        ) {
          completed = true;
          currentState = "completed";
          persistSupervisorStatus();
          log(`Worker completed all tracked tasks for ${workflow.name}.`);
          return 0;
        }

        const reason = worker.error
          ? `worker startup error: ${worker.error}`
          : `worker exit ${worker.exitCode ?? worker.exitSignal ?? "unknown"}`;
        await restartWorker(reason);
        continue;
      }

      if (worker && isWorkerRuntimeStalled(worker, workerSnapshot, stallMs)) {
        currentState = "restarting";
        persistSupervisorStatus();
        const stalledPid = worker.child.pid ?? null;
        const reason = `runtime stall (${formatSupervisorWorkerSummary(workerSnapshot)})`;
        await terminateProcessTree(stalledPid, runtime.sleep);
        if (worker) {
          worker.exited = true;
          worker.exitSignal = worker.exitSignal ?? "SIGTERM";
        }
        cleanupWorkerLock(repoRoot, workflow);
        supervisorStatus.lastWorkerExitCode = worker?.exitCode ?? null;
        supervisorStatus.lastWorkerSignal = worker?.exitSignal ?? "SIGTERM";
        await restartWorker(reason);
        continue;
      }

      await sleepAsync(checkIntervalMs, runtime.sleep);
    }

    return 0;
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    currentState = "error";
    workerSnapshot = readSupervisorWorkerSnapshot(
      repoRoot,
      workflow,
      worker?.child.pid ?? null,
    );
    persistSupervisorStatus();
    error(message);
    return 1;
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    if (worker?.child.pid) {
      await terminateProcessTree(worker.child.pid, runtime.sleep);
      cleanupWorkerLock(repoRoot, workflow);
    }
    if (!completed) {
      currentState = "stopped";
      workerSnapshot = readSupervisorWorkerSnapshot(repoRoot, workflow);
      persistSupervisorStatus();
    }
    releaseRuntimeLock(supervisorLockPath);
  }
}

async function startOrchestratorSupervisor(
  options: OrchestratorSupervisorCliOptions,
  runtime: OrchestratorSupervisorRuntimeOptions = {},
): Promise<number> {
  const log = runtime.log ?? ((message: string) => console.log(message));
  const repoRoot = runtime.repoRoot ? resolve(runtime.repoRoot) : process.cwd();
  const workflow = loadWorkflow(repoRoot, options.workflowFile);
  const supervisorScriptPath = resolve(
    runtime.scriptPath ??
      process.argv[1] ??
      "scripts/orchestrator-supervisor.ts",
  );
  const supervisorStatusPath = getSupervisorStatusPath(repoRoot, workflow);

  assertSupervisorCanStart(repoRoot, workflow);

  const child = spawn(
    process.execPath,
    [
      supervisorScriptPath,
      "run",
      "--workflow",
      options.workflowFile,
      "--stall-seconds",
      String(options.stallSeconds),
      "--check-interval-seconds",
      String(options.checkIntervalSeconds),
      "--restart-delay-seconds",
      String(options.restartDelaySeconds),
    ],
    {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      env: process.env,
    },
  );
  child.unref();

  const startDeadline = Date.now() + 5000;
  while (Date.now() < startDeadline) {
    if (child.pid && !isProcessAlive(child.pid)) {
      throw new Error(
        `Supervisor for ${workflow.name} exited before it wrote ${relative(repoRoot, supervisorStatusPath) || supervisorStatusPath}.`,
      );
    }

    const status = loadSupervisorStatus(repoRoot, workflow);
    if (status?.pid === child.pid) {
      log(
        `Started supervisor for ${workflow.name} (pid ${child.pid}). Status file: ${relative(repoRoot, supervisorStatusPath) || supervisorStatusPath}.`,
      );
      return 0;
    }

    await sleepAsync(100, runtime.sleep);
  }

  log(
    `Started supervisor for ${workflow.name} (pid ${child.pid ?? "unknown"}). Status file: ${relative(repoRoot, supervisorStatusPath) || supervisorStatusPath}.`,
  );
  return 0;
}

async function stopOrchestratorSupervisor(
  options: OrchestratorSupervisorCliOptions,
  runtime: OrchestratorSupervisorRuntimeOptions = {},
): Promise<number> {
  const log = runtime.log ?? ((message: string) => console.log(message));
  const repoRoot = runtime.repoRoot ? resolve(runtime.repoRoot) : process.cwd();
  const workflow = loadWorkflow(repoRoot, options.workflowFile);
  const lockPath = getSupervisorLockPath(repoRoot, workflow);
  const owner = readLockOwner(lockPath);
  const pid =
    owner?.pid ?? loadSupervisorStatus(repoRoot, workflow)?.pid ?? null;

  if (tryRemoveStaleLock(lockPath)) {
    log(`Removed a stale supervisor lock for ${workflow.name}.`);
    return 0;
  }

  if (!pid || !isProcessAlive(pid)) {
    log(`Supervisor for ${workflow.name} is not running.`);
    return 0;
  }

  sendSignalToProcessTree(pid, "SIGTERM");
  if (!(await waitForProcessExit(pid, 10_000, runtime.sleep))) {
    sendSignalToProcessTree(pid, "SIGKILL");
    await waitForProcessExit(pid, 2_000, runtime.sleep);
  }
  tryRemoveStaleLock(lockPath);
  log(`Stopped supervisor for ${workflow.name}.`);
  return 0;
}

function formatTimestampSummary(value: string | null | undefined): string {
  return value ? value : "none";
}

function formatSupervisorStatusReport(
  repoRoot: string,
  workflow: WorkflowConfig,
): string {
  const lockPath = getSupervisorLockPath(repoRoot, workflow);
  const owner = readLockOwner(lockPath);
  const supervisorRunning =
    owner?.pid !== null &&
    owner?.pid !== undefined &&
    isProcessAlive(owner.pid);
  const supervisorStatus = loadSupervisorStatus(repoRoot, workflow);
  const workerSnapshot = readSupervisorWorkerSnapshot(repoRoot, workflow);
  const supervisorStatusPath = relative(
    repoRoot,
    getSupervisorStatusPath(repoRoot, workflow),
  );
  const workerStatusPath = relative(
    repoRoot,
    getRuntimeStatusPath(repoRoot, workflow),
  );
  const workerHeartbeatPath = relative(
    repoRoot,
    getRuntimeHeartbeatPath(repoRoot, workflow),
  );

  return [
    `Supervisor: ${supervisorRunning ? "running" : "not running"}`,
    `Workflow: ${workflow.name} (${workflow.workflowPath})`,
    `Supervisor PID: ${
      supervisorRunning ? owner?.pid : (supervisorStatus?.pid ?? "none")
    }`,
    `Supervisor state: ${supervisorStatus?.state ?? "unknown"}`,
    `Restarts: ${supervisorStatus?.restartCount ?? 0}`,
    `Last restart: ${supervisorStatus?.lastRestartReason ?? "none"}`,
    `Worker PID: ${workerSnapshot.pid ?? supervisorStatus?.worker.pid ?? "none"}`,
    `Worker phase: ${workerSnapshot.phase ?? supervisorStatus?.worker.phase ?? "unknown"}`,
    `Worker task: ${
      workerSnapshot.activeTaskId ??
      supervisorStatus?.worker.activeTaskId ??
      "none"
    }`,
    `Worker heartbeat: ${formatTimestampSummary(workerSnapshot.heartbeatAt ?? supervisorStatus?.worker.heartbeatAt)}`,
    `Worker waitingUntil: ${formatTimestampSummary(workerSnapshot.waitingUntil ?? supervisorStatus?.worker.waitingUntil)}`,
    `Worker last note: ${workerSnapshot.lastNote ?? supervisorStatus?.worker.lastNote ?? "none"}`,
    `Worker last error: ${workerSnapshot.lastError ?? supervisorStatus?.worker.lastError ?? "none"}`,
    `Supervisor status file: ${supervisorStatusPath || getSupervisorStatusPath(repoRoot, workflow)}`,
    `Worker status file: ${workerStatusPath || getRuntimeStatusPath(repoRoot, workflow)}`,
    `Worker heartbeat file: ${workerHeartbeatPath || getRuntimeHeartbeatPath(repoRoot, workflow)}`,
  ].join("\n");
}

export async function runOrchestratorSupervisorCli(
  argv: string[],
  runtime: OrchestratorSupervisorRuntimeOptions = {},
): Promise<number> {
  const log = runtime.log ?? ((message: string) => console.log(message));
  const error = runtime.error ?? ((message: string) => console.error(message));

  let options: OrchestratorSupervisorCliOptions;
  try {
    options = parseOrchestratorSupervisorCliArgs(argv);
  } catch (caughtError) {
    error(
      caughtError instanceof Error ? caughtError.message : String(caughtError),
    );
    error(formatOrchestratorSupervisorCliUsage());
    return 1;
  }

  if (options.help) {
    log(formatOrchestratorSupervisorCliUsage());
    return 0;
  }

  try {
    if (options.command === "start") {
      return await startOrchestratorSupervisor(options, runtime);
    }

    if (options.command === "stop") {
      return await stopOrchestratorSupervisor(options, runtime);
    }

    if (options.command === "status") {
      const repoRoot = runtime.repoRoot
        ? resolve(runtime.repoRoot)
        : process.cwd();
      const workflow = loadWorkflow(repoRoot, options.workflowFile);
      log(formatSupervisorStatusReport(repoRoot, workflow));
      return 0;
    }

    return await runOrchestratorSupervisor(options, runtime);
  } catch (caughtError) {
    error(
      caughtError instanceof Error ? caughtError.message : String(caughtError),
    );
    return 1;
  }
}

function requireLaunchdInstallSupport(
  runtime: Pick<OrchestratorLaunchdRuntimeOptions, "platform" | "uid">,
): number {
  const platform = runtime.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error(
      "launchd install and uninstall are only supported on macOS. The core worker and supervisor CLIs remain cross-platform.",
    );
  }

  const uid = resolveLaunchdUid(runtime);
  if (uid === null || uid < 0) {
    throw new Error(
      "Could not determine the current macOS user id for launchctl.",
    );
  }

  return uid;
}

function runOrchestratorLaunchdPrint(
  options: OrchestratorLaunchdCliOptions,
  runtime: OrchestratorLaunchdRuntimeOptions = {},
): number {
  const log = runtime.log ?? ((message: string) => console.log(message));
  const repoRoot = runtime.repoRoot ? resolve(runtime.repoRoot) : process.cwd();
  const workflow = loadWorkflow(repoRoot, options.workflowFile);

  log(buildOrchestratorLaunchdPlist(repoRoot, workflow, options, runtime));
  return 0;
}

function installOrchestratorLaunchd(
  options: OrchestratorLaunchdCliOptions,
  runtime: OrchestratorLaunchdRuntimeOptions = {},
): number {
  const log = runtime.log ?? ((message: string) => console.log(message));
  const repoRoot = runtime.repoRoot ? resolve(runtime.repoRoot) : process.cwd();
  const workflow = loadWorkflow(repoRoot, options.workflowFile);
  const uid = requireLaunchdInstallSupport(runtime);
  const label = buildOrchestratorLaunchdLabel(
    repoRoot,
    workflow,
    options.label,
  );
  const plistPath = getOrchestratorLaunchdPlistPath(
    repoRoot,
    workflow,
    {
      label: options.label,
      launchAgentDir: options.launchAgentDir,
      home: options.home,
    },
    runtime,
  );
  const stdoutPath = getLaunchdStdoutPath(repoRoot, workflow);
  const stderrPath = getLaunchdStderrPath(repoRoot, workflow);
  const launchctl = runtime.runLaunchctl ?? defaultRunLaunchctl;
  const domainTarget = getLaunchdDomainTarget(uid);

  ensureDirectory(dirname(plistPath));
  ensureDirectory(dirname(stdoutPath));
  ensureDirectory(dirname(stderrPath));
  writeFileSync(
    plistPath,
    buildOrchestratorLaunchdPlist(repoRoot, workflow, options, runtime) + "\n",
  );

  launchctl(["bootout", domainTarget, plistPath]);

  const bootstrapResult = launchctl(["bootstrap", domainTarget, plistPath]);
  if (bootstrapResult.status !== 0) {
    throw new Error(
      `Failed to bootstrap launchd agent ${label}: ${formatLaunchctlError(bootstrapResult, "launchctl bootstrap failed")}`,
    );
  }

  const kickstartResult = launchctl([
    "kickstart",
    "-k",
    getLaunchdServiceTarget(uid, label),
  ]);
  if (kickstartResult.status !== 0) {
    throw new Error(
      `Failed to kickstart launchd agent ${label}: ${formatLaunchctlError(kickstartResult, "launchctl kickstart failed")}`,
    );
  }

  log(
    `Installed launchd agent ${label} for ${workflow.name}. Plist: ${plistPath}. Logs: ${stdoutPath} and ${stderrPath}.`,
  );
  return 0;
}

function uninstallOrchestratorLaunchd(
  options: OrchestratorLaunchdCliOptions,
  runtime: OrchestratorLaunchdRuntimeOptions = {},
): number {
  const log = runtime.log ?? ((message: string) => console.log(message));
  const repoRoot = runtime.repoRoot ? resolve(runtime.repoRoot) : process.cwd();
  const workflow = loadWorkflow(repoRoot, options.workflowFile);
  const uid = requireLaunchdInstallSupport(runtime);
  const label = buildOrchestratorLaunchdLabel(
    repoRoot,
    workflow,
    options.label,
  );
  const plistPath = getOrchestratorLaunchdPlistPath(
    repoRoot,
    workflow,
    {
      label: options.label,
      launchAgentDir: options.launchAgentDir,
      home: options.home,
    },
    runtime,
  );
  const launchctl = runtime.runLaunchctl ?? defaultRunLaunchctl;

  launchctl(["bootout", getLaunchdDomainTarget(uid), plistPath]);
  rmSync(plistPath, { force: true });

  log(`Removed launchd agent ${label}. Plist: ${plistPath}.`);
  return 0;
}

export function runOrchestratorLaunchdCli(
  argv: string[],
  runtime: OrchestratorLaunchdRuntimeOptions = {},
): number {
  const log = runtime.log ?? ((message: string) => console.log(message));
  const error = runtime.error ?? ((message: string) => console.error(message));

  let options: OrchestratorLaunchdCliOptions;
  try {
    options = parseOrchestratorLaunchdCliArgs(argv);
  } catch (caughtError) {
    error(
      caughtError instanceof Error ? caughtError.message : String(caughtError),
    );
    error(formatOrchestratorLaunchdCliUsage());
    return 1;
  }

  if (options.help) {
    log(formatOrchestratorLaunchdCliUsage());
    return 0;
  }

  try {
    if (options.command === "install") {
      return installOrchestratorLaunchd(options, runtime);
    }

    if (options.command === "uninstall") {
      return uninstallOrchestratorLaunchd(options, runtime);
    }

    return runOrchestratorLaunchdPrint(options, runtime);
  } catch (caughtError) {
    error(
      caughtError instanceof Error ? caughtError.message : String(caughtError),
    );
    return 1;
  }
}
