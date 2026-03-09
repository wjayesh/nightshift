# Billing Report Tasks

This file is meant to be copied to `docs/tasks.md` in a new repo.

### 1.1 Define export job contract

- **ID**: `BILL-001`
- **Status**: `done`
- **Priority**: P0
- **Depends on**: None
- **Notes**:
  - 2026-03-10: Chose asynchronous export jobs so large billing reports do not time out normal web requests.

Describe the shared export job payload used by the API route and the dashboard UI.

**Acceptance Criteria**

- [x] Shared TypeScript type exists for export job status
- [x] Job response shape includes `jobId`, `status`, and `downloadUrl`
- [x] The reasoning is captured in `docs/decisions.md`

### 1.2 Add export job API route

- **ID**: `BILL-002`
- **Status**: `pending`
- **Priority**: P1
- **Depends on**: BILL-001

Implement `POST /api/reports/exports` so the server validates the date range, queues a job, and returns the initial job record.

**Acceptance Criteria**

- [ ] Invalid date ranges are rejected
- [ ] Queued jobs return a stable `jobId`
- [ ] The response matches the shared export contract

### 1.3 Show export progress in the dashboard

- **ID**: `BILL-003`
- **Status**: `pending`
- **Priority**: P1
- **Depends on**: BILL-002

Add dashboard polling so finance users can see `queued`, `running`, and `completed` states before downloading the CSV.

**Acceptance Criteria**

- [ ] Export controls show a pending state while work is running
- [ ] Completed jobs expose a download link
- [ ] Failed jobs surface a retry-friendly error message
