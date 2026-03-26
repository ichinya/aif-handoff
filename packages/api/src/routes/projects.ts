import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { getDb, projects, logger } from "@aif/shared";
import { createProjectSchema } from "../schemas.js";
import { broadcast } from "../ws.js";

const log = logger("projects-route");

export const projectsRouter = new Hono();

// GET /projects
projectsRouter.get("/", (c) => {
  const db = getDb();
  const all = db.select().from(projects).all();
  log.debug({ count: all.length }, "Listed all projects");
  return c.json(all);
});

// POST /projects
projectsRouter.post("/", zValidator("json", createProjectSchema), async (c) => {
  const body = c.req.valid("json");
  const db = getDb();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(projects)
    .values({
      id,
      name: body.name,
      rootPath: body.rootPath,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const created = db.select().from(projects).where(eq(projects.id, id)).get();
  log.debug({ projectId: id, name: body.name }, "Project created");

  broadcast({ type: "project:created" as any, payload: created! });
  return c.json(created, 201);
});

// PUT /projects/:id
projectsRouter.put("/:id", zValidator("json", createProjectSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid("json");
  const db = getDb();

  const existing = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!existing) {
    return c.json({ error: "Project not found" }, 404);
  }

  db.update(projects)
    .set({ name: body.name, rootPath: body.rootPath, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, id))
    .run();

  const updated = db.select().from(projects).where(eq(projects.id, id)).get();
  log.debug({ projectId: id }, "Project updated");
  return c.json(updated);
});

// DELETE /projects/:id
projectsRouter.delete("/:id", (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const existing = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!existing) {
    return c.json({ error: "Project not found" }, 404);
  }

  db.delete(projects).where(eq(projects.id, id)).run();
  log.debug({ projectId: id }, "Project deleted");

  return c.json({ success: true });
});
