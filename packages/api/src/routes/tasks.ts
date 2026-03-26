import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, asc } from "drizzle-orm";
import { applyHumanTaskEvent, getDb, tasks, taskComments, logger } from "@aif/shared";
import type { Task } from "@aif/shared";
import {
  createTaskSchema,
  updateTaskSchema,
  taskEventSchema,
  createTaskCommentSchema,
  reorderTaskSchema,
  broadcastTaskSchema,
} from "../schemas.js";
import { broadcast } from "../ws.js";

const log = logger("tasks-route");

export const tasksRouter = new Hono();

function getTaskById(id: string) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  return { db, task };
}

function parseAttachments(raw: string | null): Array<{
  name: string;
  mimeType: string;
  size: number;
  content: string | null;
}> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        name: typeof item.name === "string" ? item.name : "file",
        mimeType: typeof item.mimeType === "string" ? item.mimeType : "application/octet-stream",
        size: typeof item.size === "number" ? item.size : 0,
        content: typeof item.content === "string" ? item.content : null,
      }));
  } catch {
    return [];
  }
}

function toTaskResponse(task: typeof tasks.$inferSelect): Task {
  const { attachments, ...rest } = task;
  return {
    ...rest,
    attachments: parseAttachments(attachments),
  };
}

// POST /tasks/:id/broadcast — emit WS update for a task (used by agent process)
tasksRouter.post(
  "/:id/broadcast",
  zValidator("json", broadcastTaskSchema),
  async (c) => {
    const { id } = c.req.param();
    const { type } = c.req.valid("json");
    const { task } = getTaskById(id);
    if (!task) return c.json({ error: "Task not found" }, 404);

    broadcast({ type, payload: toTaskResponse(task) });
    log.debug({ taskId: id, type }, "Task WS broadcast triggered");
    return c.json({ success: true });
  }
);

// GET /tasks?projectId=xxx — list by project, sorted by status order + position
tasksRouter.get("/", (c) => {
  const projectId = c.req.query("projectId");
  const db = getDb();

  let allTasks;
  if (projectId) {
    allTasks = db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.status), asc(tasks.position))
      .all();
  } else {
    allTasks = db
      .select()
      .from(tasks)
      .orderBy(asc(tasks.status), asc(tasks.position))
      .all();
  }

  log.debug({ count: allTasks.length, projectId }, "Listed tasks");
  return c.json(allTasks.map((task) => toTaskResponse(task)));
});

// POST /tasks — create
tasksRouter.post("/", zValidator("json", createTaskSchema), async (c) => {
  const body = c.req.valid("json");
  const db = getDb();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(tasks)
    .values({
      id,
      projectId: body.projectId,
      title: body.title,
      description: body.description,
      attachments: JSON.stringify(body.attachments ?? []),
      priority: body.priority,
      autoMode: body.autoMode,
      status: "backlog",
      position: 1000.0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const created = db.select().from(tasks).where(eq(tasks.id, id)).get();
  log.debug({ taskId: id, title: body.title }, "Task created");

  broadcast({
    type: "task:created",
    payload: toTaskResponse(created!),
  });
  return c.json(toTaskResponse(created!), 201);
});

// GET /tasks/:id — full detail
tasksRouter.get("/:id", (c) => {
  const { id } = c.req.param();
  const { task } = getTaskById(id);
  if (!task) {
    log.debug({ taskId: id }, "Task not found");
    return c.json({ error: "Task not found" }, 404);
  }

  log.debug({ taskId: id }, "Task fetched");
  return c.json(toTaskResponse(task));
});

// GET /tasks/:id/comments — list comments
tasksRouter.get("/:id/comments", (c) => {
  const { id } = c.req.param();
  const { db, task } = getTaskById(id);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const comments = db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, id))
    .orderBy(asc(taskComments.createdAt))
    .all()
    .map((comment) => ({
      id: comment.id,
      taskId: comment.taskId,
      author: comment.author,
      message: comment.message,
      attachments: parseAttachments(comment.attachments),
      createdAt: comment.createdAt,
    }));

  return c.json(comments);
});

// POST /tasks/:id/comments — create a human comment
tasksRouter.post(
  "/:id/comments",
  zValidator("json", createTaskCommentSchema),
  (c) => {
    const { id } = c.req.param();
    const body = c.req.valid("json");
    const { db, task } = getTaskById(id);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const commentId = crypto.randomUUID();
    const now = new Date().toISOString();
    const attachments = body.attachments ?? [];

    db.insert(taskComments)
      .values({
        id: commentId,
        taskId: id,
        author: "human",
        message: body.message,
        attachments: JSON.stringify(attachments),
        createdAt: now,
      })
      .run();

    const created = db
      .select()
      .from(taskComments)
      .where(eq(taskComments.id, commentId))
      .get();

    return c.json({
      id: created!.id,
      taskId: created!.taskId,
      author: created!.author,
      message: created!.message,
      attachments: parseAttachments(created!.attachments),
      createdAt: created!.createdAt,
    }, 201);
  }
);

// PUT /tasks/:id — update fields
tasksRouter.put("/:id", zValidator("json", updateTaskSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid("json");
  const { db, task: existing } = getTaskById(id);
  if (!existing) {
    return c.json({ error: "Task not found" }, 404);
  }

  const { attachments, ...restBody } = body;
  const updatePayload = {
    ...restBody,
    updatedAt: new Date().toISOString(),
  };
  if (attachments) {
    Object.assign(updatePayload, { attachments: JSON.stringify(attachments) });
  }

  db.update(tasks)
    .set(updatePayload)
    .where(eq(tasks.id, id))
    .run();

  const updated = db.select().from(tasks).where(eq(tasks.id, id)).get();
  log.debug({ taskId: id, fields: Object.keys(body) }, "Task updated");

  broadcast({
    type: "task:updated",
    payload: toTaskResponse(updated!),
  });
  return c.json(toTaskResponse(updated!));
});

// DELETE /tasks/:id
tasksRouter.delete("/:id", (c) => {
  const { id } = c.req.param();
  const { db, task: existing } = getTaskById(id);
  if (!existing) {
    return c.json({ error: "Task not found" }, 404);
  }

  db.delete(tasks).where(eq(tasks.id, id)).run();
  db.delete(taskComments).where(eq(taskComments.taskId, id)).run();
  log.debug({ taskId: id }, "Task deleted");

  broadcast({ type: "task:deleted", payload: { id } });
  return c.json({ success: true });
});

// POST /tasks/:id/events — apply a human action through state machine
tasksRouter.post(
  "/:id/events",
  zValidator("json", taskEventSchema),
  async (c) => {
    const { id } = c.req.param();
    const { event } = c.req.valid("json");
    const { db, task: existing } = getTaskById(id);
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const transition = applyHumanTaskEvent(toTaskResponse(existing), event);
    if (!transition.ok) {
      return c.json({ error: transition.error }, 409);
    }

    db.update(tasks)
      .set({ ...transition.patch, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .run();

    const updated = db.select().from(tasks).where(eq(tasks.id, id)).get();
    log.debug(
      { taskId: id, from: existing.status, to: updated?.status, event },
      "Task state transition applied"
    );

    broadcast({
      type: "task:moved",
      payload: toTaskResponse(updated!),
    });
    return c.json(toTaskResponse(updated!));
  }
);

// PATCH /tasks/:id/position — reorder within column
tasksRouter.patch(
  "/:id/position",
  zValidator("json", reorderTaskSchema),
  async (c) => {
    const { id } = c.req.param();
    const { position } = c.req.valid("json");
    const { db, task: existing } = getTaskById(id);
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    db.update(tasks)
      .set({ position, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .run();

    const updated = db.select().from(tasks).where(eq(tasks.id, id)).get();
    log.debug({ taskId: id, position }, "Task reordered");

    broadcast({
      type: "task:updated",
      payload: toTaskResponse(updated!),
    });
    return c.json(toTaskResponse(updated!));
  }
);
