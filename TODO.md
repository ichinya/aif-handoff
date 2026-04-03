# TODO — Log Analysis (2026-04-03)

## Full task path: "Landing"

**backlog → planning → plan_ready → implementing → review → done** — ~14 min total. Pipeline completed without hanging.

---

## Problems

### - [x] 1. ERROR (level 50): Wake channel at startup

**Log line 44** — Agent tries to connect to WebSocket before API is ready. Gets `TypeError` in `#onSocketClose`. Reconnects successfully ~5 sec later (line 58). **Race condition at startup** — agent starts before API.

### - [x] 2. WARN (level 40): Plan checker returned non-plan content

**Log line 343** — `"Plan checker returned non-plan-like content; keeping existing task plan"`. Plan-checker ran but its response wasn't recognized as a plan. Existing plan preserved, task continued — not a blocker, but plan-checker spent ~50 sec for nothing.

### - [x] 3. Slow endpoint `/chat/sessions` (277–433ms) — SDK listSessions bottleneck

On every project switch SDK scans **ALL sessions** from disk via `listSessions()`. Session count grows with every agent run and this endpoint will only get slower over time. Already the slowest request in the system (everything else <13ms).

Observed:

- 158 sessions → 305ms
- 439 sessions → 400ms
- 442 sessions → 415ms
- 445 sessions → 433ms

**Fix options:** cache session list with TTL invalidation, paginate/limit SDK scan, or index sessions in SQLite instead of scanning filesystem.

### - [x] 4. Duplicate requests from frontend

On every navigation/mount:

- `GET /settings` — called **twice**
- `GET /projects/:id/defaults` — called **twice**
- `GET /agent/readiness` — called **twice**

### - [x] 5. WebSocket churn

On every navigation the frontend creates **2 WS connections**, the first one disconnects immediately. Likely double mount (React StrictMode?).

### - [x] 6. Co-Authored-By in subagent commits

implement-coordinator adds `Co-Authored-By` trailer to commits. User memory prohibits this. Subagent doesn't know — need to propagate rule to agent definition or hook.

### - [x] 7. Agent hang detection gaps

Monitoring exists but has critical holes:

**What works:**

- Heartbeat every 30 sec (updates `lastHeartbeatAt` in DB)
- Stage timeout: 60 min hard limit via `withTimeout()`
- Query start timeout: 60 sec + 1 retry for initial handshake
- Stale watchdog: 90 min without heartbeat → `blocked_external` (max 3 retries, then quarantine)

**What's missing:**

- **No process termination** — when `withTimeout()` fires, only the await is rejected; the subagent process keeps running (zombie)
- **No AbortController** — can't cancel a running Claude Agent SDK query
- **No inter-message timeout** — if subagent produces 1 message then hangs, system waits full 60 min stage timeout
- **No `/agent/status` endpoint** — `/agent/readiness` only checks auth; no way to see running tasks, heartbeat lag, or resource usage in UI
- **Heartbeat not exposed in UI** — heartbeat is written to DB but never displayed to the user

**Practical impact:** You can only detect a hung agent after 90 min (stale watchdog). No intermediate "agent unresponsive for 5 min" state exists.

### - [x] 8. Activity log garbles multiline commands

When subagent runs multiline bash (e.g. `git commit` with heredoc), the activity log squashes it into one line — shows raw `EOF\n)"` garbage. Should either truncate to first line or replace `\n` with spaces for readability.

---

## Timing by stage

| Stage                                  | Time        |
| -------------------------------------- | ----------- |
| Planning (plan-coordinator)            | ~4 min      |
| Plan-checker                           | ~50 sec     |
| Implementation (implement-coordinator) | ~7.5 min    |
| Review (review + security sidecars)    | ~41 sec     |
| **Total**                              | **~14 min** |

---

## What's normal

- All API responses (except chat/sessions) < 13ms
- WebSocket broadcast works correctly
- Wake signals delivered, debounce works
- "Previous poll cycle still running, skipping" — expected during long agents
- Task completed full pipeline without fatal errors
