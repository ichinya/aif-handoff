export const TASK_STATUSES = [
  "backlog",
  "planning",
  "plan_ready",
  "implementing",
  "review",
  "blocked_external",
  "done",
  "verified",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  rootPath: string;
}

export interface TaskCommentAttachment {
  name: string;
  mimeType: string;
  size: number;
  content: string | null;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  attachments?: TaskCommentAttachment[];
  autoMode: boolean;
  status: TaskStatus;
  priority: number;
  position: number;
  plan: string | null;
  implementationLog: string | null;
  reviewComments: string | null;
  agentActivityLog: string | null;
  blockedReason: string | null;
  blockedFromStatus: TaskStatus | null;
  retryAfter: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  author: "human" | "agent";
  message: string;
  attachments: TaskCommentAttachment[];
  createdAt: string;
}

/** POST /tasks/:id/comments body */
export interface CreateTaskCommentInput {
  message: string;
  attachments?: TaskCommentAttachment[];
}

/** POST /tasks body */
export interface CreateTaskInput {
  projectId: string;
  title: string;
  description: string;
  priority?: number;
  autoMode?: boolean;
}

/** PUT /tasks/:id body */
export interface UpdateTaskInput {
  title?: string;
  description?: string;
  attachments?: TaskCommentAttachment[];
  priority?: number;
  autoMode?: boolean;
  plan?: string | null;
  implementationLog?: string | null;
  reviewComments?: string | null;
  agentActivityLog?: string | null;
  blockedReason?: string | null;
  blockedFromStatus?: TaskStatus | null;
  retryAfter?: string | null;
  retryCount?: number;
}

export const TASK_EVENTS = [
  "start_ai",
  "start_implementation",
  "request_replanning",
  "approve_done",
  "request_changes",
  "retry_from_blocked",
] as const;

export type TaskEvent = (typeof TASK_EVENTS)[number];

/** POST /tasks/:id/events body */
export interface TaskEventInput {
  event: TaskEvent;
}

/** PATCH /tasks/:id/position body */
export interface ReorderTaskInput {
  position: number;
}

/** WebSocket event types */
export type WsEventType =
  | "task:created"
  | "task:updated"
  | "task:deleted"
  | "task:moved";

export interface WsEvent {
  type: WsEventType;
  payload: Task | { id: string };
}
