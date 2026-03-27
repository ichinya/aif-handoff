[Back to README](../README.md) · [Architecture →](architecture.md)

# Getting Started

## Prerequisites

- **Node.js** 18+ (ES2022 target)
- **npm** 10+ (npm workspaces)
- **Claude subscription** or Anthropic API key (for agent features)

## Installation

```bash
git clone https://github.com/lee-to/aif-handoff.git
cd aif-handoff
npm install
```

## Database Setup

The project uses SQLite via `better-sqlite3` + `drizzle-orm`. Initialize the database:

```bash
npm run db:setup
```

This creates the `data/` directory and pushes the Drizzle schema to `data/aif.sqlite`.

To apply schema changes later:

```bash
npm run db:push
```

## Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | *(optional)* | API key. Agent SDK uses `~/.claude/` auth by default |
| `PORT` | `3001` | API server port |
| `POLL_INTERVAL_MS` | `30000` | Agent coordinator polling interval (ms) |
| `AGENT_STAGE_STALE_TIMEOUT_MS` | `1200000` | Stale-stage watchdog timeout (ms) before auto-recovery |
| `AGENT_STAGE_STALE_MAX_RETRY` | `3` | Max stale auto-recover attempts before quarantine in `blocked_external` |
| `DATABASE_URL` | `./data/aif.sqlite` | SQLite database path |
| `AGENT_QUERY_AUDIT_ENABLED` | `true` | Enable/disable query audit logs in `logs/*.log` |
| `LOG_LEVEL` | `debug` | Log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |

You can set planner/plan-checker/implementer/review budgets per project in the project edit dialog. Leave any budget field empty for unlimited.

See [Configuration](configuration.md) for details.

## Running

Start all services with hot reload:

```bash
npm run dev
```

This runs three processes in parallel via Turborepo:

| Service | URL | Description |
|---------|-----|-------------|
| **API** | `http://localhost:3001` | REST + WebSocket server |
| **Web** | `http://localhost:5173` | Kanban board UI |
| **Agent** | *(background)* | Polls every 30s, dispatches subagents |

## Verify It Works

1. Open `http://localhost:5173` — you should see the Kanban board
2. Create a project (top-left selector)
3. Add a task to the Backlog column
4. If agent is running with valid credentials, the task will automatically move through stages

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all services with hot reload |
| `npm run build` | Build all packages |
| `npm test` | Run all tests (Vitest) |
| `npm run db:setup` | Create data dir + push schema |
| `npm run db:push` | Push schema changes |

## Next Steps

- [Architecture](architecture.md) — understand the agent pipeline and module structure
- [API Reference](api.md) — explore the REST and WebSocket API

## See Also

- [Architecture](architecture.md) — project structure and agent pipeline
- [API Reference](api.md) — endpoints and WebSocket events
- [Configuration](configuration.md) — environment variables in detail
