# AIF Handoff

> Autonomous Kanban board where AI agents plan, implement, and review your tasks — fully hands-off.

Built on top of [AI Factory](https://github.com/lee-to/ai-factory) workflow and powered by [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents/claude-agent-sdk) subagents. Tasks flow through stages automatically: **Backlog → Planning → Plan Ready → Implementing → Review → Done** — each stage orchestrated by specialized AI subagents following the AIF methodology.

## Key Features

- **Fully autonomous pipeline** — create a task, AI plans, implements, and reviews it
- **Beautiful Kanban UI** — drag-and-drop board with real-time WebSocket updates
- **AI Factory core** — built on [ai-factory](https://github.com/lee-to/ai-factory) agent definitions and skill system
- **Subagent orchestration** — plan-coordinator, implement-coordinator, review + security sidecars
- **Layer-aware execution** — implementer computes dependency layers and enforces parallel worker dispatch where possible
- **Self-healing pipeline** — heartbeat + stale-stage watchdog auto-recovers stuck agent stages
- **Human-in-the-loop** — approve plans, request changes, or let auto-mode handle everything

## Quick Start

```bash
git clone https://github.com/lee-to/aif-handoff.git
cd aif-handoff
npm install
npm run init
npm run dev
```

This starts three services in parallel via Turborepo:

| Service | URL | Description |
|---------|-----|-------------|
| **API** | `http://localhost:3001` | Hono REST + WebSocket server |
| **Web** | `http://localhost:5173` | React Kanban UI |
| **Agent** | *(background)* | Polls every 30s, dispatches subagents |

### Authentication

The Agent SDK uses `~/.claude/` credentials by default (your active Claude subscription). No API key needed.

To use a separate API key, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`.

## Architecture

```
packages/
├── shared/    # Types, SQLite schema (drizzle-orm), DB connection, constants, logger
├── api/       # Hono REST + WebSocket server (port 3001)
├── web/       # React + Vite + TailwindCSS — Kanban UI (port 5173)
└── agent/     # Coordinator (node-cron) + Claude Agent SDK subagents
```

### Agent Pipeline

The coordinator polls every 30 seconds and delegates to `.claude/agents/` definitions:

| Stage | Agent | What it does |
|-------|-------|-------------|
| Backlog → Planning → Plan Ready | `plan-coordinator` | Iterative plan refinement via `plan-polisher` |
| Plan Ready → Implementing → Review | `implement-coordinator` | Parallel task execution with worktrees + quality sidecars |
| Review → Done | `review-sidecar` + `security-sidecar` | Code review and security audit in parallel |

### Fault Tolerance

- Task liveness is tracked with `lastHeartbeatAt`.
- If a stage (`planning`, `implementing`, `review`) stops heartbeating longer than timeout, coordinator moves task to `blocked_external` with retry backoff.
- After max stale retries, task is quarantined for manual intervention.

All agents are loaded via `settingSources: ["project"]` from `.claude/agents/*.md` — the same agent definitions used by [AI Factory](https://github.com/lee-to/ai-factory).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + TypeScript |
| Monorepo | Turborepo |
| Database | SQLite (better-sqlite3 + drizzle-orm) |
| API | Hono + @hono/node-server + WebSocket |
| Validation | zod + @hono/zod-validator |
| Frontend | React + Vite + TailwindCSS |
| Drag & Drop | @dnd-kit |
| Server State | @tanstack/react-query |
| Agent SDK | @anthropic-ai/claude-agent-sdk |
| Scheduler | node-cron |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all services with hot reload |
| `npm run build` | Build all packages |
| `npm test` | Run all tests (Vitest) |
| `npm run init` | Run AI Factory init and database setup |
| `npm run aif:init` | Initialize AI Factory context in this project |
| `npm run db:setup` | Create data directory and push schema |
| `npm run db:push` | Push schema changes via drizzle-kit |

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, setup, first steps |
| [Architecture](docs/architecture.md) | Agent pipeline, state machine, data flow |
| [API Reference](docs/api.md) | REST endpoints, WebSocket events |
| [Configuration](docs/configuration.md) | Environment variables, logging, auth |

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## Security

If you discover a security vulnerability, please see [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

MIT License — see [LICENSE](LICENSE) for details.
