# Decisions

This file is meant to be copied to `docs/decisions.md` in a new repo.

## 2026-03-10 - BILL-001 - Run report exports asynchronously

- Context: Monthly billing exports can take longer than a normal HTTP request budget.
- Decision: Queue CSV exports as jobs and return a `jobId` immediately from the API.
- Impact: The UI can poll job status, and the shared contract needs explicit `queued`, `running`, `completed`, and `failed` states.
