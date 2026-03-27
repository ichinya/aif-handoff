import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { getDb, projects, logger, initProjectDirectory } from "@aif/shared";
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
      plannerMaxBudgetUsd: body.plannerMaxBudgetUsd ?? null,
      planCheckerMaxBudgetUsd: body.planCheckerMaxBudgetUsd ?? null,
      implementerMaxBudgetUsd: body.implementerMaxBudgetUsd ?? null,
      reviewSidecarMaxBudgetUsd: body.reviewSidecarMaxBudgetUsd ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  initProjectDirectory(body.rootPath);

  const created = db.select().from(projects).where(eq(projects.id, id)).get();
  log.debug({ projectId: id, name: body.name }, "Project created");
  broadcast({ type: "project:created", payload: created! });
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
    .set({
      name: body.name,
      rootPath: body.rootPath,
      plannerMaxBudgetUsd: body.plannerMaxBudgetUsd ?? null,
      planCheckerMaxBudgetUsd: body.planCheckerMaxBudgetUsd ?? null,
      implementerMaxBudgetUsd: body.implementerMaxBudgetUsd ?? null,
      reviewSidecarMaxBudgetUsd: body.reviewSidecarMaxBudgetUsd ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projects.id, id))
    .run();

  const updated = db.select().from(projects).where(eq(projects.id, id)).get();
  log.debug({ projectId: id }, "Project updated");
  return c.json(updated);
});

// GET /projects/:id/mcp — read .mcp.json from project directory
projectsRouter.get("/:id/mcp", (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const mcpPath = resolve(project.rootPath, ".mcp.json");
  if (!existsSync(mcpPath)) {
    return c.json({ mcpServers: {} });
  }

  try {
    const raw = readFileSync(mcpPath, "utf-8");
    const parsed = JSON.parse(raw);
    return c.json({ mcpServers: parsed.mcpServers ?? {} });
  } catch {
    return c.json({ mcpServers: {} });
  }
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
