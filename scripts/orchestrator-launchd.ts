#!/usr/bin/env bun
import { runOrchestratorLaunchdCli } from "../src/orchestrator";

const exitCode = runOrchestratorLaunchdCli(process.argv.slice(2));
process.exit(exitCode);
