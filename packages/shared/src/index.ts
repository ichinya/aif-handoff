// Schema
export { projects, tasks, taskComments } from "./schema.js";
export type {
  ProjectRow,
  NewProjectRow,
  TaskRow,
  NewTaskRow,
  TaskCommentRow,
  NewTaskCommentRow,
} from "./schema.js";

// Types
export {
  TASK_STATUSES,
  type TaskStatus,
  type Project,
  type CreateProjectInput,
  type Task,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskComment,
  type TaskCommentAttachment,
  type CreateTaskCommentInput,
  TASK_EVENTS,
  type TaskEvent,
  type TaskEventInput,
  type ReorderTaskInput,
  type WsEventType,
  type WsEvent,
} from "./types.js";

// Database
export { getDb, createTestDb, closeDb } from "./db.js";

// Environment
export { getEnv, validateEnv } from "./env.js";
export type { Env } from "./env.js";

// Constants
export { STATUS_CONFIG, ORDERED_STATUSES } from "./constants.js";
export { applyHumanTaskEvent, HUMAN_ACTIONS_BY_STATUS } from "./stateMachine.js";

// Logger
export { logger, rootLogger } from "./logger.js";

// Project initialization
export { initProjectDirectory } from "./projectInit.js";
