#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

ARGS=("$@")

for ((index = 0; index < ${#ARGS[@]}; index += 1)); do
  if [[ "${ARGS[$index]}" == "--workflow" ]]; then
    bun run scripts/orchestrator.ts "${ARGS[@]}"
    exit 0
  fi
done

bun run scripts/orchestrator.ts --workflow WORKFLOW.orchestrator.md "${ARGS[@]}"
