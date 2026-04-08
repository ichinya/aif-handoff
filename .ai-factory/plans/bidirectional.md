# Implementation Plan: Bidirectional Handoff <-> AIF Sync

Branch: feature/bidirectional-aif-sync
Created: 2026-03-31

## Settings
- Testing: yes
- Logging: verbose
- Docs: yes

## Roadmap Linkage
Milestone: "Bidirectional Handoff <-> AIF Sync"
Rationale: Directly corresponds to the unchecked roadmap milestone "Bidirectional Handoff <-> AIF Sync" in ROADMAP.md.

## Overview

Implement a Model Context Protocol (MCP) server that enables two-way synchronization between the Handoff task management system and AI Factory (AIF) tooling. AIF tools (Claude Code with ai-factory skills) will be able to read, create, and update tasks in Handoff; sync status changes bidirectionally; annotate plans with Handoff task IDs for traceability; and push plan content back to Handoff tasks.

### Architecture Decisions

- **MCP server as a new package** (`packages/mcp`, `@aif/mcp`) rather than embedded in the API. This keeps the MCP protocol boundary clean and respects the modular monolith architecture. The MCP server imports `@aif/data` for DB access (same pattern as `api` and `agent`).
- **Plan annotation format:** `<!-- handoff:task:<uuid> -->` HTML comment markers embedded in plan markdown. These are invisible in rendered markdown but machine-parseable.
- **Conflict resolution:** Last-write-wins with timestamp comparison. The `lastSyncedAt` column on the tasks table tracks when each task was last synced via MCP. When a field was modified on both sides since last sync, the newer `updatedAt` wins. Conflicts are logged as WARN with full before/after context so operators can audit.
- **Sync events** are broadcast over the existing WebSocket system so the Kanban UI reflects MCP-driven changes in real time.
- **Rate limiting:** Per-tool rate limits enforced in the MCP server layer (not in data layer) to protect against runaway AIF tool loops.
- **Timestamp precision:** The current SQLite `updatedAt` uses `datetime('now')` with second resolution. For reliable conflict detection, this will be migrated to millisecond-precision ISO strings using `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`.

### MCP Tools (planned)

| Tool | Description |
|------|-------------|
| `handoff_list_tasks` | List tasks with optional project/status/search filters |
| `handoff_get_task` | Get a single task by ID with full detail |
| `handoff_search_tasks` | Full-text search across title and description |
| `handoff_create_task` | Create a new task in Handoff |
| `handoff_update_task` | Update task fields (title, description, status, plan, etc.) |
| `handoff_sync_status` | Bidirectional status sync with conflict detection |
| `handoff_push_plan` | Push plan content to a task, with annotation parsing |
| `handoff_annotate_plan` | Insert/update `<!-- handoff:task:<id> -->` markers in plan text |
| `handoff_list_projects` | List available projects |

### Parallel Execution Tracks

Tasks are organized into three parallel tracks where possible:

```
Track A (foundation):     Task 1 (scaffold) --> Task 3 (MCP server core)
Track B (shared+data):    Task 2 (types) + Task 10 (search) [parallel] --> Task 12 (shared tests)
Track C (schema):         Task 2a (updatedAt migration + lastSyncedAt)

After all tracks converge:
  Task 4,5 (read/write tools) --> Task 6,7,8,9 (sync/plan tools) --> Task 11,13,14,15 (config+tests) --> Task 16 (docs)
```

## Tasks

### Phase 1: Foundation -- package scaffolding, shared contracts, data layer, and schema migration

These tasks have no interdependencies and can be executed in parallel.

<!-- parallel: tasks 1, 2, 2a, 10 -->
- [x] Task 1: Create `packages/mcp` package scaffolding with TypeScript config, package.json (`@aif/mcp`), and Turborepo integration.
  Files to create/modify:
  - `packages/mcp/package.json` (new)
  - `packages/mcp/tsconfig.json` (new)
  - `packages/mcp/src/index.ts` (new, entry point)
  - `turbo.json` (add mcp package tasks)
  - Root `package.json` (workspaces already glob `packages/*`, verify)
  Dependencies: `@aif/data`, `@aif/shared`, `@modelcontextprotocol/sdk` (MCP SDK for TypeScript)
  Deliverable: Package builds successfully, imports from `@aif/data` and `@aif/shared` work.
  LOGGING REQUIREMENTS: INFO for package initialization; DEBUG for dependency resolution during startup.

- [x] Task 2: Define shared sync types and plan annotation utilities in `@aif/shared`.
  Files to create/modify:
  - `packages/shared/src/sync.ts` (new) -- SyncEvent, SyncDirection, ConflictResolution types, annotation regex/parser/inserter
  - `packages/shared/src/types.ts` -- add WsEventType entries for sync events (`sync:task_created`, `sync:task_updated`, `sync:status_changed`, `sync:plan_pushed`)
  - `packages/shared/src/index.ts` -- re-export sync utilities
  - `packages/shared/src/browser.ts` -- re-export sync types (browser-safe subset)
  Deliverable: `parsePlanAnnotations(markdown)` returns `Array<{ taskId: string, line: number }>`. `insertPlanAnnotation(markdown, taskId, sectionHeading)` returns annotated markdown. `SyncEvent` type covers all sync operations with timestamps and direction.
  LOGGING REQUIREMENTS: DEBUG for annotation parse/insert operations with line numbers; WARN for malformed annotations that are skipped.

- [x] Task 2a: Migrate `updatedAt` to millisecond precision and add `lastSyncedAt` column for sync state tracking.
  Files to create/modify:
  - `packages/shared/src/schema.ts` -- change `updatedAt` default from `datetime('now')` to `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` for both `tasks` and `projects` tables; add `lastSyncedAt` text column to `tasks` table (nullable, set by MCP sync operations)
  - `packages/data/src/index.ts` -- ensure all `updateTask` calls that set `updatedAt` use the new millisecond format; add helper `touchLastSyncedAt(taskId)` function
  - Migration SQL or drizzle-kit migration for existing data (update existing `updatedAt` values to include `.000` fractional seconds for consistency)
  Dependencies: none.
  Deliverable: `updatedAt` values are ISO strings with millisecond precision (e.g., `2026-03-31T12:00:00.123Z`). `lastSyncedAt` is populated when a task is synced via MCP. Existing data migrated cleanly.
  LOGGING REQUIREMENTS: INFO for migration start/completion; WARN for any rows that fail to migrate; DEBUG for row-level migration detail.

- [x] Task 10: Add full-text search query function to `@aif/data` for MCP search tool.
  Files to create/modify:
  - `packages/data/src/index.ts` -- add `searchTasks(query: string, projectId?: string): TaskRow[]`
  Dependencies: none.
  Deliverable: SQL LIKE-based search across `title` and `description` columns. Case-insensitive. Returns matching TaskRow array ordered by updatedAt desc. Limit to 50 results.
  LOGGING REQUIREMENTS: INFO for search with query term (truncated) and result count; DEBUG for generated SQL; WARN for search queries that hit the 50-result cap.

### Phase 2: MCP server core and read tools

- [x] Task 3: Implement MCP server bootstrap with `@modelcontextprotocol/sdk`, stdio transport, tool registration framework, and rate limiting middleware.
  Files to create/modify:
  - `packages/mcp/src/index.ts` -- MCP server initialization, tool registry, stdio transport
  - `packages/mcp/src/tools/index.ts` (new) -- tool registration helper
  - `packages/mcp/src/middleware/rateLimit.ts` (new) -- per-tool rate limiter: token bucket algorithm, configurable via env (MCP_RATE_LIMIT_RPM, MCP_RATE_LIMIT_BURST), read tools default 120 rpm, write tools default 30 rpm
  - `packages/mcp/src/middleware/errorHandler.ts` (new) -- structured error responses with MCP error codes, global error handler, MCP error code mapping
  - `packages/mcp/src/env.ts` (new) -- env validation (DATABASE_URL, rate limit config, API_URL for broadcasts)
  Dependencies: Task 1.
  Deliverable: MCP server starts via `npx @aif/mcp` or `node packages/mcp/dist/index.js`, responds to `tools/list`, rate limiter rejects excess calls with appropriate MCP error. Error handler catches unhandled exceptions and returns structured MCP errors.
  LOGGING REQUIREMENTS: INFO for server start/stop with transport type and rate limit config; DEBUG for each tool invocation with parameters (sanitized) and token bucket state; WARN for rate limit hits with tool name and client context; ERROR for unhandled tool exceptions with stack trace.

- [x] Task 4: Implement read-only MCP tools: `handoff_list_tasks`, `handoff_get_task`, `handoff_search_tasks`, `handoff_list_projects`.
  Files to create/modify:
  - `packages/mcp/src/tools/listTasks.ts` (new)
  - `packages/mcp/src/tools/getTask.ts` (new)
  - `packages/mcp/src/tools/searchTasks.ts` (new) -- uses `searchTasks()` from `@aif/data` (Task 10)
  - `packages/mcp/src/tools/listProjects.ts` (new)
  Dependencies: Task 3, Task 10.
  Input validation: Each tool validates inputs with zod schemas. `listTasks` validates projectId (optional UUID), status (optional valid TaskStatus). `getTask` validates taskId (required UUID). `searchTasks` validates query (required non-empty string, max 200 chars), projectId (optional UUID). `listProjects` has no required params. All tools return structured MCP errors for validation failures with field-level detail.
  Deliverable: AIF tools can query Handoff tasks by project, status, and free-text search. Results include full task detail (plan, status, comments). Search uses the `searchTasks()` data layer function.
  LOGGING REQUIREMENTS: INFO for each tool call with filter summary and result count; DEBUG for query parameters; WARN for queries returning 0 results with non-trivial filters; ERROR for validation failures with field-level detail.

### Phase 3: Write tools and status sync

- [x] Task 5: Implement write MCP tools: `handoff_create_task`, `handoff_update_task`.
  Files to create/modify:
  - `packages/mcp/src/tools/createTask.ts` (new)
  - `packages/mcp/src/tools/updateTask.ts` (new)
  Dependencies: Task 4.
  Input validation: `createTask` validates with zod: projectId (required UUID, must reference existing project), title (required non-empty string, max 500 chars), description (optional string), priority (optional 0-3), tags (optional string array), plannerMode (optional, enum 'fast'|'full'), etc. `updateTask` validates taskId (required UUID, must exist), plus all mutable fields as optional. Both return structured MCP errors for validation failures.
  Deliverable: AIF tools can create tasks in Handoff with all standard fields and update existing tasks. Returns created/updated task.
  LOGGING REQUIREMENTS: INFO for create/update with task ID and changed fields summary; DEBUG for full input payload; ERROR for validation failures with field-level detail.

- [x] Task 6: Implement `handoff_sync_status` tool with bidirectional conflict detection and resolution.
  Files to create/modify:
  - `packages/mcp/src/tools/syncStatus.ts` (new)
  - `packages/mcp/src/sync/conflictResolver.ts` (new) -- last-write-wins logic comparing `sourceTimestamp` against task `updatedAt` (millisecond precision from Task 2a), with `lastSyncedAt` tracking
  Dependencies: Task 2, Task 2a, Task 5.
  Input validation: Validates with zod: taskId (required UUID, must exist), newStatus (required valid TaskStatus), sourceTimestamp (required ISO string with millisecond precision), direction (required enum 'aif_to_handoff'|'handoff_to_aif'). Returns structured MCP errors for invalid inputs.
  Deliverable: Tool accepts `{ taskId, newStatus, sourceTimestamp, direction }`. Compares `sourceTimestamp` against task `updatedAt` (millisecond precision). If Handoff is newer and status differs, returns conflict info without overwriting (caller decides). If source is newer or same, applies status change and updates `lastSyncedAt`. Validates transitions against state machine (`applyHumanTaskEvent` or direct agent transitions). Returns `{ applied: boolean, conflict: boolean, task, lastSyncedAt }`.
  LOGGING REQUIREMENTS: INFO for every sync attempt with direction and outcome; WARN for conflicts with full before/after detail; DEBUG for timestamp comparison logic; ERROR for invalid state transitions with current and requested status.

- [x] Task 7: Add WebSocket broadcast for sync events so the Kanban UI updates in real time when MCP tools modify tasks.
  Files to create/modify:
  - `packages/mcp/src/notifier.ts` (new) -- HTTP call to API broadcast endpoint (same pattern as `packages/agent/src/notifier.ts`)
  Dependencies: Task 5.
  Deliverable: When MCP tools create or update tasks, a WebSocket broadcast is sent via the API's existing `/tasks/:id/broadcast` endpoint. Uses same `task:created`, `task:updated` event types.
  LOGGING REQUIREMENTS: INFO for successful broadcast with event type; DEBUG for broadcast payload; WARN for broadcast failures (best-effort, non-blocking); ERROR for repeated broadcast failures with circuit-breaker consideration.

### Phase 4: Plan sync and annotation

- [x] Task 8: Implement `handoff_push_plan` tool that writes plan content to a task's `plan` field with annotation preservation.
  Files to create/modify:
  - `packages/mcp/src/tools/pushPlan.ts` (new)
  Dependencies: Task 2, Task 5.
  Input validation: Validates with zod: taskId (required UUID, must exist), planContent (required string, max 100KB). Returns structured MCP errors for validation failures.
  Deliverable: Tool accepts `{ taskId, planContent }`. Parses annotations from incoming plan, stores plan text in task's `plan` field via `@aif/data`. If plan contains `<!-- handoff:task:<id> -->` markers, validates referenced task IDs exist. Returns updated task with annotation metadata.
  LOGGING REQUIREMENTS: INFO for plan push with task ID and plan size; DEBUG for annotation parsing results; WARN for referenced task IDs that do not exist; ERROR for plan write failures.

- [x] Task 9: Implement `handoff_annotate_plan` tool that inserts or updates task ID annotations in plan markdown.
  Files to create/modify:
  - `packages/mcp/src/tools/annotatePlan.ts` (new)
  Dependencies: Task 2, Task 8.
  Input validation: Validates with zod: taskId (required UUID), planContent (required string, max 100KB), sectionHeading (optional string, max 200 chars). Returns structured MCP errors for validation failures.
  Deliverable: Tool accepts `{ taskId, planContent, sectionHeading? }`. Inserts `<!-- handoff:task:<taskId> -->` after the specified section heading (or at the top if no heading specified). If annotation already exists for this taskId, updates its position. Returns annotated plan text. Does NOT write to DB -- caller uses `handoff_push_plan` or `handoff_update_task` to persist.
  LOGGING REQUIREMENTS: INFO for annotation insert/update with task ID and target location; DEBUG for full plan diff (before/after annotation); WARN for duplicate annotations found and resolved.

### Phase 5: MCP configuration

- [x] Task 11: Add MCP server configuration to `.mcp.json` and document setup for AIF tools.
  Files to create/modify:
  - `.mcp.json` -- add `handoff` server entry pointing to `packages/mcp/dist/index.js`
  - `packages/mcp/.env.example` (new) -- environment variable documentation
  Dependencies: Task 3.
  Deliverable: After `npm run build`, `claude` CLI auto-discovers Handoff MCP server. Environment variables documented and validated at startup.
  LOGGING REQUIREMENTS: INFO for config load with resolved paths; WARN for missing optional config with defaults applied; ERROR for missing required config with actionable message.

### Phase 6: Testing

All test tasks can begin as soon as their subject code is complete. Test tasks within this phase are independent and can run in parallel.

- [x] Task 12: Unit tests for shared sync utilities (annotation parsing, insertion, conflict resolution).
  Files to create/modify:
  - `packages/shared/src/__tests__/sync.test.ts` (new)
  Dependencies: Task 2.
  Deliverable: Tests cover: annotation parsing from plan markdown (single, multiple, malformed, empty), annotation insertion (with heading, without, duplicate), SyncEvent type validation. Minimum 90% coverage of sync.ts.
  LOGGING REQUIREMENTS: n/a (test file).

- [x] Task 13: Unit tests for MCP tools (read tools, write tools, status sync, plan tools).
  Files to create/modify:
  - `packages/mcp/src/__tests__/listTasks.test.ts` (new)
  - `packages/mcp/src/__tests__/getTask.test.ts` (new)
  - `packages/mcp/src/__tests__/searchTasks.test.ts` (new)
  - `packages/mcp/src/__tests__/createTask.test.ts` (new)
  - `packages/mcp/src/__tests__/updateTask.test.ts` (new)
  - `packages/mcp/src/__tests__/syncStatus.test.ts` (new)
  - `packages/mcp/src/__tests__/pushPlan.test.ts` (new)
  - `packages/mcp/src/__tests__/annotatePlan.test.ts` (new)
  Dependencies: Task 4, Task 5, Task 6, Task 8, Task 9.
  Deliverable: Each tool tested with: valid input, invalid input (validation errors), edge cases (empty results, missing tasks, conflict scenarios). Mock `@aif/data` functions. Minimum 80% coverage per tool file.
  LOGGING REQUIREMENTS: n/a (test files).

- [x] Task 14: Unit tests for data layer search function and sync timestamp helpers.
  Files to create/modify:
  - `packages/data/src/__tests__/search.test.ts` (new) or extend `packages/data/src/__tests__/index.test.ts`
  Dependencies: Task 10, Task 2a.
  Deliverable: Tests cover: basic search, case-insensitive matching, project-scoped search, no results, result limit enforcement, `touchLastSyncedAt` function, millisecond precision in updatedAt.
  LOGGING REQUIREMENTS: n/a (test file).

- [x] Task 15: Integration test for MCP server end-to-end flow.
  Files to create/modify:
  - `packages/mcp/src/__tests__/integration.test.ts` (new)
  Dependencies: Task 4, Task 5, Task 6, Task 8.
  Deliverable: Test starts MCP server with in-memory SQLite, exercises full flow: create project, create task, list tasks, search, update status with sync (including lastSyncedAt verification), push plan with annotations. Verifies WebSocket broadcast calls. Verifies rate limiting rejects excess calls. Minimum 70% overall package coverage.
  LOGGING REQUIREMENTS: n/a (test file).

### Phase 7: Documentation

- [x] Task 16: Document MCP server setup, available tools, and sync protocol in project docs.
  Files to create/modify:
  - `docs/mcp-sync.md` (new) -- MCP server documentation: setup, tools reference, annotation format, conflict resolution strategy (including lastSyncedAt tracking and millisecond-precision timestamps), rate limits
  - `docs/api.md` -- add section about MCP sync integration and WebSocket sync events
  - `README.md` -- add MCP sync to feature list
  Dependencies: Task 11.
  Deliverable: Complete documentation covering: installation, configuration, tool reference with input/output schemas, plan annotation format specification, conflict resolution behavior, troubleshooting guide.
  LOGGING REQUIREMENTS: n/a (documentation).

## Commit Plan
- **Commit 1** (after Tasks 1, 2, 2a, 10): `feat(shared,data,mcp): scaffold MCP package, add sync types, millisecond timestamps, and data layer search`
- **Commit 2** (after Tasks 3-4): `feat(mcp): implement MCP server bootstrap with rate limiting, error handling, and read-only tools`
- **Commit 3** (after Tasks 5-7): `feat(mcp): add write tools, status sync with lastSyncedAt tracking, and WebSocket broadcast`
- **Commit 4** (after Tasks 8-9, 11): `feat(mcp): add plan push/annotate tools and MCP configuration`
- **Commit 5** (after Tasks 12-15): `test(mcp,shared,data): add unit and integration tests for MCP tools, sync utilities, and search`
- **Commit 6** (after Task 16): `docs: add MCP sync server documentation`

## Notes
- The MCP server uses stdio transport (standard for Claude Code MCP servers) -- no HTTP server needed for the MCP protocol itself.
- DB access goes through `@aif/data` only (enforced by lint guard). The MCP package follows the same dependency rules as `api` and `agent`.
- The `@modelcontextprotocol/sdk` package provides the MCP server framework. Check latest version at npm.
- Plan annotations use HTML comments (`<!-- handoff:task:<uuid> -->`) which are invisible in rendered markdown but parseable by both Handoff and AIF.
- WebSocket broadcasts from MCP use the same HTTP-based notification pattern as the agent package (POST to `/tasks/:id/broadcast`).
- State machine transitions in `handoff_sync_status` must respect the existing `applyHumanTaskEvent` rules. Agent-driven transitions (planning->plan_ready, etc.) should also be supported through a separate validation path.
- The conflict resolution strategy (last-write-wins with timestamp) is simple and appropriate for the expected usage pattern (single AIF instance + single Handoff instance). If multi-instance sync is needed later, vector clocks or CRDTs can replace this.
- **Timestamp precision:** SQLite's `datetime('now')` has only second resolution. Task 2a migrates to `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` for millisecond precision, which is required for reliable conflict detection in `handoff_sync_status`.
- **Sync state tracking:** The `lastSyncedAt` column on the tasks table records the last time a task was synced via MCP. This is distinct from `updatedAt` (which changes on any modification) and enables the conflict resolver to determine whether changes happened since the last sync.
