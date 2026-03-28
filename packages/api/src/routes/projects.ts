import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { logger } from "@aif/shared";
import { findTaskById } from "@aif/data";
import { createProjectSchema, roadmapImportSchema } from "../schemas.js";
import { broadcast } from "../ws.js";
import {
  listProjects,
  findProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectMcpServers,
} from "../repositories/projects.js";
import { toTaskResponse } from "../repositories/tasks.js";
import {
  generateRoadmapTasks,
  importGeneratedTasks,
  RoadmapGenerationError,
} from "../services/roadmapGeneration.js";

const log = logger("projects-route");

export const projectsRouter = new Hono();

// GET /projects
projectsRouter.get("/", (c) => {
  const all = listProjects();
  log.debug({ count: all.length }, "Listed all projects");
  return c.json(all);
});

// POST /projects
projectsRouter.post("/", zValidator("json", createProjectSchema), async (c) => {
  const body = c.req.valid("json");
  const { project: created, pathError } = createProject(body);
  if (pathError) return c.json({ error: pathError }, 400);
  if (!created) return c.json({ error: "Failed to create project" }, 500);

  log.debug({ projectId: created.id, name: body.name }, "Project created");
  broadcast({ type: "project:created", payload: created });
  return c.json(created, 201);
});

// PUT /projects/:id
projectsRouter.put("/:id", zValidator("json", createProjectSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid("json");

  const existing = findProjectById(id);
  if (!existing) {
    return c.json({ error: "Project not found" }, 404);
  }

  const { project: updated, pathError } = updateProject(id, body);
  if (pathError) return c.json({ error: pathError }, 400);

  log.debug({ projectId: id }, "Project updated");
  return c.json(updated);
});

// GET /projects/:id/mcp — read .mcp.json from project directory
projectsRouter.get("/:id/mcp", (c) => {
  const { id } = c.req.param();
  const project = findProjectById(id);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json({ mcpServers: getProjectMcpServers(id) });
});

// POST /projects/:id/roadmap/import — trigger roadmap import and create backlog tasks
projectsRouter.post("/:id/roadmap/import", zValidator("json", roadmapImportSchema), async (c) => {
  const { id } = c.req.param();
  const { roadmapAlias } = c.req.valid("json");

  const project = findProjectById(id);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  log.info({ projectId: id, roadmapAlias }, "Roadmap import requested");

  try {
    // Generate tasks from roadmap via Agent SDK
    const generation = await generateRoadmapTasks({
      projectId: id,
      roadmapAlias,
    });

    // Import with dedupe and tag enrichment
    const result = importGeneratedTasks(id, generation);

    // Broadcast each created task
    for (const taskId of result.taskIds) {
      const task = findTaskById(taskId);
      if (task) {
        broadcast({ type: "task:created", payload: toTaskResponse(task) });
      }
    }

    // Wake coordinator to process new backlog items
    if (result.created > 0) {
      broadcast({ type: "agent:wake", payload: { id } });
      log.info(
        { projectId: id, roadmapAlias, created: result.created },
        "Batch wake event sent after roadmap import",
      );
    }

    log.info(
      { projectId: id, roadmapAlias, created: result.created, skipped: result.skipped },
      "Roadmap import completed",
    );

    return c.json(result, 201);
  } catch (err) {
    if (err instanceof RoadmapGenerationError) {
      const status =
        err.code === "PROJECT_NOT_FOUND" || err.code === "ROADMAP_NOT_FOUND" ? 404 : 500;
      log.warn(
        { projectId: id, roadmapAlias, code: err.code, error: err.message },
        "Roadmap import failed",
      );
      return c.json({ error: err.message, code: err.code }, status);
    }
    log.error({ projectId: id, roadmapAlias, err }, "Roadmap import unexpected error");
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /projects/:id
projectsRouter.delete("/:id", (c) => {
  const { id } = c.req.param();
  const existing = findProjectById(id);
  if (!existing) {
    return c.json({ error: "Project not found" }, 404);
  }

  deleteProject(id);
  log.debug({ projectId: id }, "Project deleted");
  return c.json({ success: true });
});
