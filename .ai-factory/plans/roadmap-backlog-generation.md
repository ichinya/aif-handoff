# Implementation Plan: Roadmap -> JSON -> Backlog Task Generation with Alias and Tags

Branch: none (by user request, no branch creation)
Created: 2026-03-28

## Settings

- Testing: yes
- Logging: verbose
- Docs: yes

## Implementation Rules

- Follow SOLID principles in all new and changed code.
- Follow DRY principle: avoid duplicated logic, centralize shared behavior.

## Tasks

### Phase 1: Data Model and Contracts

- [x] Task 1: Extend task data model to support roadmap grouping metadata and tags.
  Deliverable: add `roadmapAlias` and `tags` to task storage and shared types so tasks can be grouped and filtered.
  Files: `packages/shared/src/schema.ts`, `packages/shared/src/types.ts`, `packages/shared/src/db.ts`, `packages/shared/src/index.ts`, `packages/shared/src/browser.ts`.
  Logging: in DB bootstrap log when new columns are ensured (DEBUG with column/table names), and log migration completion summary (INFO).

- [x] Task 2: Extend API DTO validation and repository mapping for new roadmap fields.
  Deliverable: support reading/writing `roadmapAlias` and `tags` in create/update/list task APIs with strict zod validation and normalization.
  Files: `packages/api/src/schemas.ts`, `packages/api/src/repositories/tasks.ts`, `packages/api/src/routes/tasks.ts`.
  Logging: log normalized roadmap metadata on task create/update (DEBUG), and validation failure context for roadmap payloads (WARN).
  Depends on: Task 1.

### Phase 2: Roadmap Parsing and Agent Query Orchestration

- [x] Task 3: Implement roadmap extraction service that reads `.ai-factory/ROADMAP.md` and calls Agent SDK query for strict JSON conversion.
  Deliverable: service that (a) verifies roadmap file exists, (b) sends second query with strict JSON schema instructions, (c) parses and validates response via zod, (d) returns normalized generation payload.
  Files: `packages/api/src/services/roadmapGeneration.ts` (new), `packages/api/src/schemas.ts` (new zod schemas for generator response).
  Logging: INFO start/finish with project and roadmap alias, DEBUG for sanitized raw agent output and normalization steps, ERROR with structured parse/validation failures.

- [x] Task 4: Add dedupe and tag enrichment policy for generated tasks.
  Deliverable: deterministic dedupe by `projectId + normalizedTitle + roadmapAlias` and automatic tag enrichment:
  required tags: `roadmap`, `rm:<alias>`, `phase:<number>`, `phase:<name>`, `seq:<nn>`.
  Files: `packages/api/src/services/roadmapGeneration.ts`, `packages/api/src/repositories/tasks.ts` (helper selectors for dedupe lookup).
  Logging: DEBUG when a task is skipped as duplicate; INFO summary with created/skipped counts by alias and phase.
  Depends on: Task 3.

### Phase 3: API Endpoint and WebSocket Integration

- [x] Task 5: Add API endpoint to trigger roadmap import and create backlog tasks in batch.
  Deliverable: `POST /projects/:id/roadmap/import` (or `/tasks/roadmap/import`) that runs generation service, inserts backlog tasks, and returns structured summary (`roadmapAlias`, counts, task ids).
  Files: `packages/api/src/routes/projects.ts` or `packages/api/src/routes/tasks.ts`, `packages/api/src/index.ts`, `packages/api/src/schemas.ts`.
  Logging: INFO endpoint invocation and completion summary; WARN on partial failures; ERROR on Agent SDK unavailability or roadmap read failure.
  Depends on: Task 4.

- [x] Task 6: Broadcast created roadmap tasks via existing WS channel and wake agent loop.
  Deliverable: for every created task send `task:created`; after batch completion send one `agent:wake` event so coordinator can pick up new backlog items quickly.
  Files: `packages/api/src/routes/...` (same endpoint handler), `packages/api/src/ws.ts` (if new helper needed).
  Logging: DEBUG per broadcast event (task id + alias), INFO one batch wake event with total created.
  Depends on: Task 5.

### Phase 4: UI Trigger and UX Feedback

- [ ] Task 7: Add UI button to trigger roadmap import for the selected project.
  Deliverable: add `Generate Roadmap` action in header or command surface, disabled when no project is selected, with loading/disabled states during request.
  Files: `packages/web/src/components/layout/Header.tsx`, `packages/web/src/App.tsx`, `packages/web/src/lib/api.ts`, `packages/web/src/hooks/useTasks.ts` (or dedicated mutation hook).
  Logging: `console.debug` request lifecycle in API client; UI-level error logs with request id/alias if response fails.
  Depends on: Task 5.

- [ ] Task 8: Show import result and provide filtering/grouping entry points by roadmap alias and phase tags.
  Deliverable: success/error notification with counts and alias; minimum UX support to identify generated group (filter pill or quick action by `rm:<alias>`).
  Files: `packages/web/src/components/layout/Header.tsx`, `packages/web/src/components/kanban/Board.tsx`, `packages/web/src/lib/notifications.ts` (if required).
  Logging: DEBUG result payload rendering and filter activation events.
  Depends on: Task 7.

### Phase 5: Testing and Documentation (Mandatory Checkpoint)

- [ ] Task 9: Add/extend tests for roadmap import pipeline and new task metadata.
  Deliverable: unit tests for schema/normalization/dedupe/tag enrichment and API route tests for success/error paths, including invalid JSON from Agent SDK.
  Files: `packages/api/src/__tests__/roadmapGeneration.test.ts` (new), `packages/api/src/__tests__/tasks.test.ts` or route-specific tests, `packages/shared/src/__tests__/...` for model serialization.
  Logging: tests assert critical log branches for parse failure and dedupe summary (where practical via logger spies).
  Depends on: Task 6.

- [ ] Task 10: Update docs for roadmap import flow, required roadmap format expectations, and tag taxonomy.
  Deliverable: document endpoint contract, UI behavior, alias/tag conventions, and rerun/dedupe behavior.
  Files: `docs/api.md`, `docs/architecture.md`, `docs/getting-started.md` (if user-flow updates needed), `AGENTS.md` or `CLAUDE.md` only if operational rule changes are introduced.
  Logging: include note in docs describing where to inspect API logs during roadmap generation failures.
  Depends on: Task 8, Task 9.

## Commit Plan

1. `feat(shared): add roadmap alias and tags to task model`
   Scope: Tasks 1-2.

2. `feat(api): implement roadmap-to-json generation and dedupe pipeline`
   Scope: Tasks 3-4.

3. `feat(api): add roadmap import endpoint with websocket broadcasts`
   Scope: Tasks 5-6.

4. `feat(web): add generate roadmap action and grouped result UX`
   Scope: Tasks 7-8.

5. `test(docs): cover roadmap import flow and document alias/tag conventions`
   Scope: Tasks 9-10.
