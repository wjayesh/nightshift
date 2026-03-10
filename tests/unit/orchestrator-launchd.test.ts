import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runOrchestratorLaunchdCli } from "../../src/orchestrator";

const LAUNCHD_SCRIPT_PATH = join(
  process.cwd(),
  "scripts/orchestrator-launchd.ts",
);
const TEMP_REPOS: string[] = [];

function createTaskDoc(taskId: string, title: string): string {
  return `### ${title}
- **ID**: \`${taskId}\`
- **Status**: \`pending\`
- **Priority**: P0
- **Depends on**: None
`;
}

function createWorkflow(taskSource: string): string {
  return [
    "---",
    "name: launchd-test",
    "task_sources:",
    `  - ${taskSource}`,
    "progress_file: .orchestrator/runtime/progress.md",
    "state_file: .orchestrator/runtime/state.json",
    "workspace_root: .orchestrator/runtime/workspaces",
    "workspace_mode: shared",
    "poll_interval_seconds: 3",
    "max_iterations: 10",
    "completion_phrase: COMPLETE",
    "terminal_commit_behavior: per_task",
    "auto_push_every_commits: 0",
    "review_every_tasks: 0",
    "---",
    "# Workflow",
    "Exercise the optional launchd wrapper.",
    "",
  ].join("\n");
}

function createTempRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "orchestrator-launchd-"));
  TEMP_REPOS.push(repoRoot);

  mkdirSync(join(repoRoot, "docs"), { recursive: true });
  writeFileSync(
    join(repoRoot, "docs/tasks.md"),
    createTaskDoc("TASK-001", "Launchd Task"),
  );
  writeFileSync(
    join(repoRoot, "WORKFLOW.launchd.md"),
    createWorkflow("docs/tasks.md"),
  );

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

describe("optional launchd wrapper", () => {
  it("prints a LaunchAgent plist with PATH and HOME", () => {
    const repoRoot = createTempRepo();
    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = runOrchestratorLaunchdCli(
      ["print", "--workflow", "WORKFLOW.launchd.md"],
      {
        repoRoot,
        env: {
          PATH: "/opt/homebrew/bin:/usr/bin:/bin",
          HOME: "/Users/tester",
        },
        scriptPath: LAUNCHD_SCRIPT_PATH,
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);

    const plist = logs.join("\n");
    expect(plist).toContain("<key>PATH</key>");
    expect(plist).toContain("/opt/homebrew/bin:/usr/bin:/bin");
    expect(plist).toContain("<key>HOME</key>");
    expect(plist).toContain("/Users/tester");
    expect(plist).toContain(join(repoRoot, "WORKFLOW.launchd.md"));
    expect(plist).toContain(
      join(process.cwd(), "scripts/orchestrator-supervisor.ts"),
    );
    expect(plist).toContain(
      join(repoRoot, ".orchestrator/runtime/launchd.out.log"),
    );
    expect(plist).toContain(
      join(repoRoot, ".orchestrator/runtime/launchd.err.log"),
    );
  });

  it("installs and uninstalls a LaunchAgent through launchctl", () => {
    const repoRoot = createTempRepo();
    const homeRoot = join(repoRoot, "home");
    const errors: string[] = [];
    const installCalls: string[][] = [];
    const uninstallCalls: string[][] = [];

    mkdirSync(homeRoot, { recursive: true });

    const installExitCode = runOrchestratorLaunchdCli(
      ["install", "--workflow", "WORKFLOW.launchd.md"],
      {
        repoRoot,
        platform: "darwin",
        uid: 501,
        homeDir: homeRoot,
        env: {
          PATH: "/opt/homebrew/bin:/usr/bin:/bin",
          HOME: homeRoot,
        },
        scriptPath: LAUNCHD_SCRIPT_PATH,
        log: () => undefined,
        error: (message) => errors.push(message),
        runLaunchctl: (args) => {
          installCalls.push(args);
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(installExitCode).toBe(0);
    expect(errors).toEqual([]);

    const launchAgentDir = join(homeRoot, "Library/LaunchAgents");
    const plistFiles = readdirSync(launchAgentDir);
    expect(plistFiles).toHaveLength(1);

    const plistPath = join(launchAgentDir, plistFiles[0]);
    const label = plistFiles[0].replace(/\.plist$/, "");
    const plist = readFileSync(plistPath, "utf8");

    expect(plist).toContain("<key>EnvironmentVariables</key>");
    expect(plist).toContain(homeRoot);
    expect(plist).toContain(
      join(repoRoot, ".orchestrator/runtime/launchd.out.log"),
    );
    expect(plist).toContain(
      join(repoRoot, ".orchestrator/runtime/launchd.err.log"),
    );
    expect(installCalls).toEqual([
      ["bootout", "gui/501", plistPath],
      ["bootstrap", "gui/501", plistPath],
      ["kickstart", "-k", `gui/501/${label}`],
    ]);
    expect(existsSync(join(repoRoot, ".orchestrator/runtime"))).toBe(true);

    const uninstallExitCode = runOrchestratorLaunchdCli(
      ["uninstall", "--workflow", "WORKFLOW.launchd.md"],
      {
        repoRoot,
        platform: "darwin",
        uid: 501,
        homeDir: homeRoot,
        env: {
          PATH: "/opt/homebrew/bin:/usr/bin:/bin",
          HOME: homeRoot,
        },
        scriptPath: LAUNCHD_SCRIPT_PATH,
        log: () => undefined,
        error: (message) => errors.push(message),
        runLaunchctl: (args) => {
          uninstallCalls.push(args);
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(uninstallExitCode).toBe(0);
    expect(uninstallCalls).toEqual([["bootout", "gui/501", plistPath]]);
    expect(existsSync(plistPath)).toBe(false);
  });

  it("keeps install and uninstall macOS-only", () => {
    const repoRoot = createTempRepo();
    const homeRoot = join(repoRoot, "home");
    const errors: string[] = [];
    const launchctlCalls: string[][] = [];

    mkdirSync(homeRoot, { recursive: true });

    const exitCode = runOrchestratorLaunchdCli(
      ["install", "--workflow", "WORKFLOW.launchd.md"],
      {
        repoRoot,
        platform: "linux",
        homeDir: homeRoot,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: homeRoot,
        },
        scriptPath: LAUNCHD_SCRIPT_PATH,
        log: () => undefined,
        error: (message) => errors.push(message),
        runLaunchctl: (args) => {
          launchctlCalls.push(args);
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("only supported on macOS");
    expect(launchctlCalls).toEqual([]);
    expect(existsSync(join(homeRoot, "Library/LaunchAgents"))).toBe(false);
  });
});
