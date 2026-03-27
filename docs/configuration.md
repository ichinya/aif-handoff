[← API Reference](api.md) · [Back to README](../README.md)

# Configuration

All configuration is done via environment variables. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

## Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ANTHROPIC_API_KEY` | string | *(optional)* | Anthropic API key. The Agent SDK uses `~/.claude/` credentials by default, so this is only needed if you want to use a separate key |
| `PORT` | number | `3001` | API server port |
| `POLL_INTERVAL_MS` | number | `30000` | How often the agent coordinator polls for tasks (milliseconds) |
| `AGENT_STAGE_STALE_TIMEOUT_MS` | number | `1200000` | Watchdog timeout for stale agent stages (planning/implementing/review) before auto-recovery is triggered |
| `AGENT_STAGE_STALE_MAX_RETRY` | number | `3` | Maximum automatic stale recoveries before task is quarantined in `blocked_external` |
| `DATABASE_URL` | string | `./data/aif.sqlite` | Path to the SQLite database file |
| `AGENT_QUERY_AUDIT_ENABLED` | boolean | `true` | Enable/disable writing agent query audit logs to `logs/*.log` |
| `LOG_LEVEL` | string | `debug` | Pino log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |

Environment validation is handled by Zod in `packages/shared/src/env.ts`. The application will fail to start with a descriptive error if required variables are invalid.

## Authentication

The Agent SDK supports two authentication methods:

1. **Default (recommended):** Uses your active Claude subscription credentials from `~/.claude/`. No configuration needed.
2. **API Key:** Set `ANTHROPIC_API_KEY` in `.env` to use a dedicated key.

## Database

The database is a single SQLite file. The default path `./data/aif.sqlite` is relative to the project root.

To use a different location:

```
DATABASE_URL=/absolute/path/to/database.sqlite
```

Initialize the schema with:

```bash
npm run db:setup
```

## Logging

Pino structured JSON logging is used throughout. Set `LOG_LEVEL` to control verbosity:

| Level | Use Case |
|-------|----------|
| `trace` | Very verbose, includes all internal details |
| `debug` | Development default — shows DB queries, WS events, agent activity |
| `info` | Production — key events only |
| `warn` | Warnings and deprecations |
| `error` | Errors only |
| `fatal` | Application crashes |

Each package creates a named logger:

```typescript
import { logger } from "@aif/shared";
const log = logger("my-module");
log.info({ key: "value" }, "Something happened");
```

Agent query audit logs are controlled by `AGENT_QUERY_AUDIT_ENABLED`. When enabled, query payloads are written to `logs/{agentName}.log` with rotation.

## Agent Polling

The coordinator checks for actionable tasks every `POLL_INTERVAL_MS` milliseconds (default: 30 seconds). Lower values mean faster task processing but more CPU usage.

For development, 30 seconds is a good default. In production, adjust based on your workload.

### Stale Task Watchdog

The coordinator includes a stale-stage watchdog:

- Tracks task liveness via `lastHeartbeatAt` (falls back to `updatedAt` for older rows).
- If a task is stale in `planning`, `implementing`, or `review` for longer than `AGENT_STAGE_STALE_TIMEOUT_MS`, it is auto-moved to `blocked_external` with backoff.
- If stale recovery count reaches `AGENT_STAGE_STALE_MAX_RETRY`, the task stays in `blocked_external` without `retryAfter` (manual intervention required).
- For stale `implementing` tasks, recovery resumes from `plan_ready` to avoid half-broken implementation continuation.

## Agent Budgets

Agent budgets are configured per project (API or Project edit dialog):

- `plannerMaxBudgetUsd`
- `planCheckerMaxBudgetUsd`
- `implementerMaxBudgetUsd`
- `reviewSidecarMaxBudgetUsd` (applies to each review/security sidecar)

If any of these values are not set, that agent runs without SDK budget limit.

## See Also

- [Getting Started](getting-started.md) — installation and first run
- [Architecture](architecture.md) — how the agent pipeline uses these settings
