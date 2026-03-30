[← Getting Started](getting-started.md) · [Back to README](../README.md) · [API Reference →](api.md)

# Architecture

## Overview

AIF Handoff is a Turborepo monorepo with five packages. The system automates task management: a React Kanban UI lets users create tasks, the API and agent operate through a centralized data layer backed by SQLite, and an agent coordinator dispatches Claude Agent SDK subagents to plan, implement, and review each task.

```
┌─────────────┐     HTTP/WS      ┌─────────────┐
│   Web (UI)  │ ◄──────────────► │  API Server  │
│  React+Vite │                  │    Hono      │
└─────────────┘                  └──────┬───────┘
                                        │
┌─────────────┐     HTTP         ┌──────┴───────┐
│ Claude Agent │ ◄──────────────► │    Agent     │
│    SDK       │                  │ Coordinator  │
└─────────────┘                  └──────┬───────┘
                                        │
                                 ┌──────┴───────┐
                                 │ @aif/data     │
                                 │ (DB access)   │
                                 └──────┬───────┘
                                        │ SQLite
                                 ┌──────┴───────┐
                                 │   Database    │
                                 │ (drizzle-orm) │
                                 └──────────────┘
```

## Packages

| Package           | Name          | Purpose                                                     |
| ----------------- | ------------- | ----------------------------------------------------------- |
| `packages/shared` | `@aif/shared` | Types, schema, state machine, constants, env, logger        |
| `packages/data`   | `@aif/data`   | Centralized DB access layer (all SQL/repository operations) |
| `packages/api`    | `@aif/api`    | Hono REST + WebSocket server (port 3009)                    |
| `packages/web`    | `@aif/web`    | React Kanban UI (port 5180)                                 |
| `packages/agent`  | `@aif/agent`  | Coordinator + Claude Agent SDK subagents                    |

### Dependency Graph

```
shared ← data
shared ← web (browser export only)
data   ← api
data   ← agent
```

No cross-dependencies between `api`, `web`, and `agent`. Runtime integration is:

- `web` ↔ `api` via HTTP/WebSocket
- `agent` → Claude Agent SDK via SDK calls
- `api`/`agent` → SQLite via `@aif/data`
- `agent` → `api` via HTTP for best-effort broadcast notifications
- Lint guard enforces this boundary: `api` and `agent` cannot import DB helpers from `@aif/shared` or SQL builders directly.

## Agent Pipeline

The coordinator (`packages/agent/src/coordinator.ts`) uses a dual-trigger model: it polls via `node-cron` every 30 seconds as a fallback and also reacts to real-time events from the API WebSocket (task creation, moves, and explicit `agent:wake` signals). Duplicate wakes are debounced. If the WebSocket is unavailable, the coordinator falls back to polling-only mode. It delegates to `.claude/agents/` definitions:

```
Backlog ──[start_ai]──► Planning ──► Plan Ready ──► Implementing ──► Review ──► Done ──► Verified
                            │              │              │              │           │
                            │              │              │              │           └─[request_changes]──► Implementing (rework)
                            │              │              │              └─[auto-mode review gate]──► request_changes ─► Implementing (rework)
                            │              │              │              │
                            │              └─[request_    │              └─────────────────────────────────►
                            │                replanning]──┘
                            │
                     plan-coordinator          implement-coordinator        review + security sidecars
```

| Stage Transition                                        | Agent                                                                     | Description                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Backlog → Planning → Plan Ready                         | `plan-coordinator`                                                        | Iterative plan refinement via `plan-polisher`                                                                           |
| Plan Ready → Implementing → Review                      | `implement-coordinator`                                                   | Parallel execution with worktrees + quality sidecars                                                                    |
| Review → Done / Review → request_changes → Implementing | `review-sidecar` + `security-sidecar` (+ auto review gate in coordinator) | Code review and security audit in parallel; in auto mode, review comments are analyzed and may trigger automatic rework |

### Reliability Guards

The pipeline includes two reliability layers for long-running autonomous execution:

- **Heartbeat liveness:** Task rows are updated with `lastHeartbeatAt` during agent activity and stage transitions.
- **Stale-stage watchdog:** On each poll cycle, tasks stuck in `planning` / `implementing` / `review` beyond timeout are auto-recovered to `blocked_external` with retry backoff.
- **Transition reset:** valid transitions clear watchdog state (`blocked*`, `retryAfter`, `retryCount`) and refresh heartbeat baseline.

For stale `implementing`, recovery resumes from `plan_ready` to force a clean implementation pass instead of continuing a potentially inconsistent in-flight run.

### Layer-Driven Implementation Dispatch

Before launching `implement-coordinator`, the implementer computes dependency layers from the active plan (`.ai-factory/PLAN.md` or `.ai-factory/FIX_PLAN.md`) and injects a precomputed execution summary into the prompt.

This makes parallelism explicit:

- layers with one ready task are sequential,
- layers with multiple ready tasks are parallel and must dispatch `implement-worker` subagents.

### Agent Definitions

All agents are defined as markdown files in `.claude/agents/*.md` and loaded by the Claude Agent SDK via `settingSources: ["project"]`. The `agent` package orchestrates _when_ to invoke them; the markdown files define _what_ they do.

## Task State Machine

Defined in `packages/shared/src/stateMachine.ts`. Human actions available per status:

| Status             | Human Actions                                            |
| ------------------ | -------------------------------------------------------- |
| `backlog`          | `start_ai`                                               |
| `planning`         | _(none — agent working)_                                 |
| `plan_ready`       | `start_implementation`, `request_replanning`, `fast_fix` |
| `implementing`     | _(none — agent working)_                                 |
| `review`           | _(none — agent working)_                                 |
| `blocked_external` | `retry_from_blocked`                                     |
| `done`             | `approve_done`, `request_changes`                        |
| `verified`         | _(terminal state)_                                       |

Tasks have an `autoMode` flag. When `true`, the agent automatically transitions through all stages. This includes an automatic post-review gate: review comments are analyzed, and if fix items are detected the coordinator applies a `request_changes`-style transition (`done -> implementing`) with an agent comment containing required fixes. When `false`, the user must manually trigger `start_implementation` from `plan_ready`.

Tasks also have a `skipReview` flag (default `false`). When `true`, the coordinator bypasses the review stage entirely — after successful implementation the task moves directly to `done`, skipping the `review-sidecar` and `security-sidecar` runs. This is useful for small changes or tasks where code review is unnecessary.

### Pause / Resume

Tasks have a `paused` flag (default `false`). When `true`, the coordinator skips the task in all selection queries:

- `findCoordinatorTaskCandidate` — paused tasks are not picked up for any stage (planning, plan-checking, implementing, reviewing).
- `listDueBlockedExternalTasks` — paused blocked tasks are not auto-released when their retry window elapses.
- `listStaleInProgressTasks` — paused tasks are not treated as stale by the watchdog, so they won't be force-recovered to `blocked_external`.

**Important:** pausing a task does **not** abort an already running agent session. If a Claude SDK query is in flight, it will finish. The pause takes effect on the **next** coordinator cycle — the task simply won't be picked up for the next stage transition.

The Pause/Resume button is shown in the TaskDetail Actions bar for active processing stages (`planning`, `plan_ready`, `implementing`, `review`, `blocked_external`). It is hidden for `backlog`, `done`, and `verified` where the agent pipeline is not running.

## Roadmap Import

The system supports bulk task creation from a project's `.ai-factory/ROADMAP.md` file via `POST /projects/:id/roadmap/import`.

**Flow:**

1. API reads `ROADMAP.md` from the project root
2. Agent SDK (haiku model) converts markdown milestones into structured JSON
3. Response is validated via zod schema
4. Tasks are created in batch with deduplication (by `projectId + normalizedTitle + roadmapAlias`)
5. Each task receives automatic tags: `roadmap`, `rm:<alias>`, `phase:<N>`, `phase:<name>`, `seq:<NN>`
6. WebSocket broadcasts `task:created` per task and `agent:wake` after batch

**Deduplication:** Re-running import with the same alias is safe — existing tasks with matching titles are skipped. This makes the endpoint idempotent for reruns.

**Tag taxonomy:** Tags enable UI filtering. The `roadmap` quick filter in the Board shows only roadmap-generated tasks. When the roadmap filter is active, a sub-filter row displays all available `roadmapAlias` values (e.g., `v1.0`, `v2.0`) as clickable chips, allowing users to narrow results to a specific roadmap. Selecting no alias shows all roadmap tasks; selecting one or more aliases filters to only those. Tags like `phase:backend` allow additional grouping refinements.

**Logging:** Import logs at INFO level for start/finish with counts, DEBUG for per-task decisions, and ERROR for parse/validation failures. Check API logs during failures by filtering for the `roadmap-generation` component.

## Real-Time Updates

The API broadcasts events via WebSocket (`/ws` endpoint) on every state change:

| Event          | Trigger                               |
| -------------- | ------------------------------------- |
| `task:created` | New task created                      |
| `task:updated` | Task fields updated                   |
| `task:moved`   | Task status changed via state machine |
| `task:deleted` | Task deleted                          |
| `agent:wake`   | Coordinator should check for work     |

The web UI connects via `useWebSocket` hook and invalidates React Query caches on incoming events. The agent coordinator also subscribes to this WebSocket to receive wake signals for immediate task processing (see Agent Pipeline above).

### Activity Logging

Agent tool events are tracked in each task's `agentActivityLog` field. Two modes are supported (configured via `ACTIVITY_LOG_MODE`):

- **sync** (default): Each event writes immediately to the database.
- **batch**: Events are buffered in an in-memory queue per task and flushed when the batch size, max age timer, or stage boundary is reached. Shutdown handlers ensure buffered entries are persisted on `SIGINT`/`SIGTERM`.

## Database

SQLite via `better-sqlite3` with `drizzle-orm` for type-safe queries. Schema is defined in `packages/shared/src/schema.ts`, and all DB reads/writes are executed through `packages/data/src/index.ts`.

Three tables:

- **tasks** — task data, status, plan, implementation log, review comments, agent activity, heartbeat metadata
- **task_comments** — human/agent comments with optional attachments
- **projects** — project metadata (name, root path, agent budgets)

### Indexes

Runtime index bootstrap creates the following indexes via `CREATE INDEX IF NOT EXISTS` at startup:

- `idx_tasks_status` — coordinator stage filtering
- `idx_tasks_retry_after` — blocked-task retry scans
- `idx_tasks_project_id` — project-scoped task lists
- `idx_tasks_status_retry` — composite for coordinator retry queries
- `idx_tasks_project_status` — composite for ordered task-list queries
- `idx_task_comments_task_id` — comment lookups by task

## See Also

- [Getting Started](getting-started.md) — installation and setup
- [API Reference](api.md) — REST endpoints and WebSocket protocol
