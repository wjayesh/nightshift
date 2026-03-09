#!/usr/bin/env bun
import { runOrchestratorSupervisorCli } from "../src/orchestrator";

const exitCode = await runOrchestratorSupervisorCli(process.argv.slice(2));
process.exit(exitCode);
