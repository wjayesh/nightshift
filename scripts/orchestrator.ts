#!/usr/bin/env bun
import { runOrchestratorCli } from "../src/orchestrator";

process.exit(runOrchestratorCli(process.argv.slice(2)));
