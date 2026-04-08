# Implementation Plan: File-Based Attachment Storage (storage/ + DB paths)

Branch: feature/attachment-storage-paths
Created: 2026-03-28

## Settings
- Testing: yes
- Logging: verbose
- Docs: yes

## Tasks

### Phase 1: Storage foundation and contracts
- [x] Task 1: Add filesystem storage module for attachments in API (`packages/api/src/services/attachmentStorage.ts`) with deterministic path strategy (`storage/projects/<projectId>/tasks/<taskId>/...`), filename sanitization, directory creation, and safe read/delete helpers.
  Deliverable: reusable service API (`saveAttachment`, `resolveAttachmentPath`, `deleteAttachment`, `cleanupTaskAttachmentFiles`) with strict path traversal protection.
  LOGGING REQUIREMENTS: DEBUG for path planning and directory creation; INFO for successful write/delete with task/comment context; WARN for cleanup misses; ERROR for filesystem failures with operation and path metadata.

- [x] Task 2: Extend shared attachment contracts to file-backed metadata (`packages/shared/src/types.ts`, `packages/shared/src/attachments.ts`, `packages/shared/src/index.ts`, `packages/shared/src/browser.ts`) by introducing `path` as primary payload and deprecating direct large `content` storage for binary files.
  Deliverable: backward-compatible types/parsers that can read legacy records and new path-based records.
  LOGGING REQUIREMENTS: DEBUG in parser branches for legacy-vs-new format decisions (non-spammy); WARN for invalid attachment payload shapes; ERROR only for unexpected parsing exceptions.

### Phase 2: API persistence and upload flow
- [x] Task 3: Implement upload persistence on task update/create and comment creation routes (`packages/api/src/routes/tasks.ts`, `packages/api/src/repositories/tasks.ts`, `packages/data/src/index.ts`) so incoming attachments are written to `storage/`, and DB stores metadata with relative `path` instead of inline binary content.
  Deliverable: all task/comment attachment writes converted to disk-backed flow with atomic DB payload assembly and unchanged API semantics for callers.
  Dependencies: Task 1, Task 2.
  LOGGING REQUIREMENTS: INFO for attachment write summary per request (count, total bytes, entity id); DEBUG for per-file normalization; ERROR for partial write failures with rollback/compensation details.

- [ ] Task 4: Add dedicated attachment read/download endpoint(s) in API (`packages/api/src/routes/tasks.ts` or a new `packages/api/src/routes/attachments.ts`) that serve files from `storage/` via validated relative paths and enforce task/project ownership checks.
  Deliverable: secure API for viewing/downloading attachments from UI without exposing arbitrary filesystem paths.
  Dependencies: Task 1, Task 3.
  LOGGING REQUIREMENTS: INFO for successful downloads (attachment id/path, mime, size); WARN for forbidden/not-found attempts; ERROR for stream/read failures.

- [ ] Task 5: Add deletion and lifecycle cleanup for attachments on remove/update/delete flows (`packages/api/src/routes/tasks.ts`, `packages/data/src/index.ts`, `packages/shared/src/db.ts` if needed for migrations) including task delete cascade and replaced-attachment orphan cleanup.
  Deliverable: no orphan growth in `storage/` for normal task/comment lifecycle operations.
  Dependencies: Task 3.
  LOGGING REQUIREMENTS: DEBUG for computed delete sets; INFO for cleanup totals; WARN for non-critical delete misses; ERROR when cleanup leaves inconsistent state.

### Phase 3: Agent integration (path-only attachment handoff)
- [ ] Task 6: Refactor agent prompt attachment formatting to pass file paths (and optional tiny text excerpts only for text files) instead of embedded base64/image content (`packages/shared/src/attachments.ts`, `packages/api/src/services/fastFix.ts`, `packages/agent/src/subagents/planner.ts`, `packages/agent/src/subagents/implementer.ts`, `packages/agent/src/subagents/reviewer.ts`).
  Deliverable: **mandatory rule** — when passing attachments to agents (task attachments, request-changes attachments, and fast-fix attachments), include only validated attachment metadata and `path`; do not inline full image/base64 payload in prompts.
  Deliverable (prompt format): each agent prompt must be in English and contain an explicit instruction block like `Also review attachments:` followed by a newline-separated list of validated attachment paths (for example, `- storage/projects/<projectId>/tasks/<taskId>/<filename>`).
  Deliverable (DRY): prompt block construction must be implemented once in a shared utility (single source of truth) and reused by planner/implementer/reviewer/fast-fix flows; duplicate prompt/path formatting logic in multiple modules is not allowed.
  Dependencies: Task 2, Task 3.
  LOGGING REQUIREMENTS: DEBUG for attachment-to-prompt projection (content omitted/path included); INFO for prompt attachment summary; WARN when path exists in DB but file missing.

- [ ] Task 7: Update web attachment UX and API client flow for file-backed attachments (`packages/web/src/components/task/TaskDetail.tsx`, `packages/web/src/components/task/useTaskDetailActions.ts`, `packages/web/src/components/task/TaskComments.tsx`, `packages/web/src/lib/api.ts`) to support upload + preview/download links via new endpoint, without pushing base64 payloads into task/comment JSON.
  Deliverable: UI can attach files, list metadata, and open/download stored files; request-changes and task-attachments use the same storage-backed pipeline.
  Dependencies: Task 3, Task 4.
  LOGGING REQUIREMENTS: DEBUG in client upload pipeline and response mapping; WARN for upload/download failures shown to user; ERROR for unrecoverable request errors with task id context.

### Phase 4: Migration, validation, and hardening
- [ ] Task 8: Add migration path and test coverage for legacy inline attachments plus new storage-backed mode (`packages/shared/src/db.ts`, `packages/api/src/__tests__/tasks.test.ts`, `packages/shared/src/__tests__/attachments.test.ts`, `packages/web/src/__tests__/TaskDetail.test.tsx`, `packages/api/src/__tests__/fastFix.test.ts`).
  Deliverable: migration utility/compat layer, updated tests for create/update/comment/request-changes/fast-fix upload/download/cleanup, and verification that agent prompts include path-only attachment references.
  Dependencies: Task 2, Task 3, Task 4, Task 6, Task 7.
  LOGGING REQUIREMENTS: INFO for migration start/finish counters; DEBUG for per-record migration decisions in dry-run/dev; ERROR for migration failures with safe resume guidance.

## Commit Plan
- **Commit 1** (after tasks 1-3): `feat(api): persist task attachments to storage and store file paths in db`
- **Commit 2** (after tasks 4-6): `feat(agent): switch attachment handoff to path-based prompts`
- **Commit 3** (after tasks 7-8): `feat(web): support stored attachment download flow and migration tests`

## Notes
- Add `storage/` to root `.gitignore`.
- Preserve backward compatibility for existing DB records where `attachments[].content` may still be present.
- Keep DB boundary intact: API and Agent access DB only via `@aif/data`.
- **Mandatory rule:** all implementation in this plan must follow SOLID and DRY principles (no duplicated logic, clear single responsibility boundaries, and composable abstractions).
