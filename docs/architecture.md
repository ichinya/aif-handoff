[← Getting Started](getting-started.md) · [Back to README](../README.md) · [API Reference →](api.md)

# Architecture

## Overview

AIF Handoff is a Turborepo monorepo with four packages. The system automates task management: a React Kanban UI lets users create tasks, an API manages state in SQLite, and an agent coordinator dispatches Claude Agent SDK subagents to plan, implement, and review each task.

```
┌─────────────┐     HTTP/WS      ┌─────────────┐
│   Web (UI)  │ ◄──────────────► │  API Server  │
│  React+Vite │                  │    Hono      │
└─────────────┘                  └──────┬───────┘
                                        │ SQLite
                                 ┌──────┴───────┐
                                 │   Database    │
                                 │ (drizzle-orm) │
                                 └──────┬───────┘
                                        │ reads/writes
┌─────────────┐     HTTP         ┌──────┴───────┐
│ Claude Agent │ ◄──────────────► │    Agent     │
│    SDK       │                  │ Coordinator  │
└─────────────┘                  └──────────────┘
```

## Packages

| Package | Name | Purpose |
|---------|------|---------|
| `packages/shared` | `@aif/shared` | Types, DB schema, state machine, constants, logger |
| `packages/api` | `@aif/api` | Hono REST + WebSocket server (port 3001) |
| `packages/web` | `@aif/web` | React Kanban UI (port 5173) |
| `packages/agent` | `@aif/agent` | Coordinator + Claude Agent SDK subagents |

### Dependency Graph

```
shared ← api
shared ← web (browser export only)
shared ← agent
```

No cross-dependencies between `api`, `web`, and `agent`. They communicate via HTTP/WebSocket at runtime.

## Agent Pipeline

The coordinator (`packages/agent/src/coordinator.ts`) polls every 30 seconds via `node-cron` and delegates to `.claude/agents/` definitions:

```
Backlog ──[start_ai]──► Planning ──► Plan Ready ──► Implementing ──► Review ──► Done ──► Verified
                            │              │              │              │           │
                            │              │              │              │           └─[request_changes]──► Planning
                            │              │              │              │
                            │              └─[request_    │              └─────────────────────────────────►
                            │                replanning]──┘
                            │
                     plan-coordinator          implement-coordinator        review + security sidecars
```

| Stage Transition | Agent | Description |
|-----------------|-------|-------------|
| Backlog → Planning → Plan Ready | `plan-coordinator` | Iterative plan refinement via `plan-polisher` |
| Plan Ready → Implementing → Review | `implement-coordinator` | Parallel execution with worktrees + quality sidecars |
| Review → Done | `review-sidecar` + `security-sidecar` | Code review and security audit in parallel |

### Reliability Guards

The pipeline includes two reliability layers for long-running autonomous execution:

- **Heartbeat liveness:** Task rows are updated with `lastHeartbeatAt` during agent activity and stage transitions.
- **Stale-stage watchdog:** On each poll cycle, tasks stuck in `planning` / `implementing` / `review` beyond timeout are auto-recovered to `blocked_external` with retry backoff.

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

| Status | Human Actions |
|--------|--------------|
| `backlog` | `start_ai` |
| `planning` | *(none — agent working)* |
| `plan_ready` | `start_implementation`, `request_replanning`, `fast_fix` |
| `implementing` | *(none — agent working)* |
| `review` | *(none — agent working)* |
| `blocked_external` | `retry_from_blocked` |
| `done` | `approve_done`, `request_changes` |
| `verified` | *(terminal state)* |

Tasks have an `autoMode` flag. When `true`, the agent automatically transitions through all stages. When `false`, the user must manually trigger `start_implementation` from `plan_ready`.

## Real-Time Updates

The API broadcasts events via WebSocket (`/ws` endpoint) on every state change:

| Event | Trigger |
|-------|---------|
| `task:created` | New task created |
| `task:updated` | Task fields updated |
| `task:moved` | Task status changed via state machine |
| `task:deleted` | Task deleted |

The web UI connects via `useWebSocket` hook and invalidates React Query caches on incoming events.

## Database

SQLite via `better-sqlite3` with `drizzle-orm` for type-safe queries. Schema is defined in `packages/shared/src/schema.ts`.

Three tables:
- **tasks** — task data, status, plan, implementation log, review comments, agent activity, heartbeat metadata
- **task_comments** — human/agent comments with optional attachments
- **projects** — project metadata (name, root path, agent budgets)

## See Also

- [Getting Started](getting-started.md) — installation and setup
- [API Reference](api.md) — REST endpoints and WebSocket protocol
