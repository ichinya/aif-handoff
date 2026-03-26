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
| `DATABASE_URL` | string | `./data/aif.sqlite` | Path to the SQLite database file |
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

## Agent Polling

The coordinator checks for actionable tasks every `POLL_INTERVAL_MS` milliseconds (default: 30 seconds). Lower values mean faster task processing but more CPU usage.

For development, 30 seconds is a good default. In production, adjust based on your workload.

## See Also

- [Getting Started](getting-started.md) — installation and first run
- [Architecture](architecture.md) — how the agent pipeline uses these settings
