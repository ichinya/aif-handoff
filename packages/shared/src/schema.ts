import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { TaskStatus } from "./types.js";

export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  plannerMaxBudgetUsd: real("planner_max_budget_usd"),
  planCheckerMaxBudgetUsd: real("plan_checker_max_budget_usd"),
  implementerMaxBudgetUsd: real("implementer_max_budget_usd"),
  reviewSidecarMaxBudgetUsd: real("review_sidecar_max_budget_usd"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

export const tasks = sqliteTable("tasks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  attachments: text("attachments").notNull().default("[]"),
  autoMode: integer("auto_mode", { mode: "boolean" }).notNull().default(true),
  isFix: integer("is_fix", { mode: "boolean" }).notNull().default(false),
  status: text("status").$type<TaskStatus>().notNull().default("backlog"),
  priority: integer("priority").notNull().default(0),
  position: real("position").notNull().default(1000.0),
  plan: text("plan"),
  implementationLog: text("implementation_log"),
  reviewComments: text("review_comments"),
  agentActivityLog: text("agent_activity_log"),
  blockedReason: text("blocked_reason"),
  blockedFromStatus: text("blocked_from_status").$type<TaskStatus | null>(),
  retryAfter: text("retry_after"),
  retryCount: integer("retry_count").notNull().default(0),
  lastHeartbeatAt: text("last_heartbeat_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;

export const taskComments = sqliteTable("task_comments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  taskId: text("task_id").notNull(),
  author: text("author").$type<"human" | "agent">().notNull().default("human"),
  message: text("message").notNull(),
  attachments: text("attachments").notNull().default("[]"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type TaskCommentRow = typeof taskComments.$inferSelect;
export type NewTaskCommentRow = typeof taskComments.$inferInsert;
