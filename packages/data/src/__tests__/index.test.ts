import { describe, it, expect, beforeEach, vi } from "vitest";
import { projects, tasks } from "@aif/shared";
import { createTestDb } from "@aif/shared/server";

const testDb = { current: createTestDb() };
vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return {
    ...actual,
    getDb: () => testDb.current,
  };
});

const {
  createTask,
  updateTask,
  setTaskFields,
  deleteTask,
  findTaskById,
  listTasks,
  toTaskResponse,
  toCommentResponse,
  listTaskComments,
  createTaskComment,
  updateTaskComment,
  getLatestHumanComment,
  getLatestReworkComment,
  listProjects,
  findProjectById,
  createProject,
  updateProject,
  deleteProject,
  findProjectByTaskId,
  appendTaskActivityLog,
  updateTaskHeartbeat,
  updateTaskStatus,
  incrementTaskTokenUsage,
  findTasksByRoadmapAlias,
  persistTaskPlanForTask,
  findCoordinatorTaskCandidate,
} = await import("../index.js");

function seedProject(id = "proj-1") {
  testDb.current
    .insert(projects)
    .values({ id, name: "Test", rootPath: "/tmp/test" })
    .run();
}

describe("data layer", () => {
  beforeEach(() => {
    testDb.current = createTestDb();
    seedProject();
  });

  // ── Tasks CRUD ──────────────────────────────────────────

  describe("createTask", () => {
    it("creates a task with defaults", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      expect(t).toBeDefined();
      expect(t!.title).toBe("T");
      expect(t!.status).toBe("backlog");
    });

    it("creates a task with all optional fields", () => {
      const t = createTask({
        projectId: "proj-1",
        title: "Full",
        description: "D",
        attachments: [{ type: "file", url: "a.txt" }],
        priority: 2,
        autoMode: true,
        isFix: true,
        plannerMode: "fast",
        planPath: "/plan.md",
        planDocs: true,
        planTests: true,
        skipReview: true,
        useSubagents: true,
        maxReviewIterations: 5,
        paused: true,
        roadmapAlias: "alias-1",
        tags: ["tag1", "tag2"],
      });
      expect(t).toBeDefined();
      expect(t!.priority).toBe(2);
      expect(t!.autoMode).toBe(true);
      expect(t!.isFix).toBe(true);
      expect(t!.roadmapAlias).toBe("alias-1");
    });
  });

  describe("listTasks", () => {
    it("lists all tasks", () => {
      createTask({ projectId: "proj-1", title: "A", description: "D" });
      createTask({ projectId: "proj-1", title: "B", description: "D" });
      expect(listTasks()).toHaveLength(2);
    });

    it("filters by projectId", () => {
      seedProject("proj-2");
      createTask({ projectId: "proj-1", title: "A", description: "D" });
      createTask({ projectId: "proj-2", title: "B", description: "D" });
      expect(listTasks("proj-1")).toHaveLength(1);
      expect(listTasks("proj-2")).toHaveLength(1);
    });
  });

  describe("updateTask", () => {
    it("updates basic fields", () => {
      const t = createTask({ projectId: "proj-1", title: "Old", description: "D" });
      const updated = updateTask(t!.id, { title: "New" });
      expect(updated!.title).toBe("New");
    });

    it("serializes attachments", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const updated = updateTask(t!.id, { attachments: [{ type: "image", url: "img.png" }] });
      expect(updated).toBeDefined();
      const resp = toTaskResponse(updated!);
      expect(resp.attachments).toHaveLength(1);
    });

    it("serializes tags", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const updated = updateTask(t!.id, { tags: ["a", "b"] });
      expect(updated).toBeDefined();
      const resp = toTaskResponse(updated!);
      expect(resp.tags).toEqual(["a", "b"]);
    });
  });

  describe("setTaskFields", () => {
    it("sets raw fields on task", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      setTaskFields(t!.id, { implementationLog: "log data" });
      const found = findTaskById(t!.id);
      expect(found!.implementationLog).toBe("log data");
    });
  });

  describe("deleteTask", () => {
    it("deletes task and its comments", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      createTaskComment({ taskId: t!.id, author: "human", message: "hi" });
      deleteTask(t!.id);
      expect(findTaskById(t!.id)).toBeUndefined();
      expect(listTaskComments(t!.id)).toHaveLength(0);
    });
  });

  // ── toTaskResponse / parseTags edge cases ───────────────

  describe("toTaskResponse", () => {
    it("handles empty tags", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const resp = toTaskResponse(t!);
      expect(resp.tags).toEqual([]);
    });

    it("handles malformed tags JSON", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      setTaskFields(t!.id, { tags: "not-json" });
      const raw = findTaskById(t!.id)!;
      const resp = toTaskResponse(raw);
      expect(resp.tags).toEqual([]);
    });

    it("filters non-string values from tags", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      setTaskFields(t!.id, { tags: JSON.stringify(["ok", 123, null]) });
      const raw = findTaskById(t!.id)!;
      const resp = toTaskResponse(raw);
      expect(resp.tags).toEqual(["ok"]);
    });
  });

  // ── Comments ────────────────────────────────────────────

  describe("comments", () => {
    it("creates and lists comments", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      createTaskComment({ taskId: t!.id, author: "human", message: "hello" });
      createTaskComment({ taskId: t!.id, author: "agent", message: "reply" });
      const comments = listTaskComments(t!.id);
      expect(comments).toHaveLength(2);
    });

    it("creates comment with custom createdAt", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const c = createTaskComment({
        taskId: t!.id,
        author: "human",
        message: "msg",
        createdAt: "2025-01-01T00:00:00Z",
      });
      expect(c!.createdAt).toBe("2025-01-01T00:00:00Z");
    });

    it("creates comment with attachments", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const c = createTaskComment({
        taskId: t!.id,
        author: "human",
        message: "msg",
        attachments: [{ type: "file", url: "f.txt" }],
      });
      const resp = toCommentResponse(c!);
      expect(resp.attachments).toHaveLength(1);
    });

    it("updateTaskComment updates attachments", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const c = createTaskComment({ taskId: t!.id, author: "human", message: "msg" });
      const updated = updateTaskComment(c!.id, {
        attachments: [{ type: "image", url: "img.png" }],
      });
      const resp = toCommentResponse(updated!);
      expect(resp.attachments).toHaveLength(1);
    });

    it("updateTaskComment with no changes returns existing", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const c = createTaskComment({ taskId: t!.id, author: "human", message: "msg" });
      const same = updateTaskComment(c!.id, {});
      expect(same!.id).toBe(c!.id);
    });

    it("getLatestHumanComment returns last human comment", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      createTaskComment({ taskId: t!.id, author: "agent", message: "a", createdAt: "2025-01-01T00:00:00Z" });
      createTaskComment({ taskId: t!.id, author: "human", message: "h1", createdAt: "2025-01-01T00:01:00Z" });
      createTaskComment({ taskId: t!.id, author: "human", message: "h2", createdAt: "2025-01-01T00:02:00Z" });
      expect(getLatestHumanComment(t!.id)!.message).toBe("h2");
    });

    it("getLatestHumanComment returns undefined when no human comments", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      createTaskComment({ taskId: t!.id, author: "agent", message: "a" });
      expect(getLatestHumanComment(t!.id)).toBeUndefined();
    });

    it("getLatestReworkComment returns last comment", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      createTaskComment({ taskId: t!.id, author: "agent", message: "a", createdAt: "2025-01-01T00:00:00Z" });
      createTaskComment({ taskId: t!.id, author: "human", message: "h", createdAt: "2025-01-01T00:01:00Z" });
      expect(getLatestReworkComment(t!.id)!.message).toBe("h");
    });
  });

  // ── Projects CRUD ───────────────────────────────────────

  describe("projects", () => {
    it("listProjects returns all projects", () => {
      expect(listProjects()).toHaveLength(1);
    });

    it("findProjectById returns project", () => {
      expect(findProjectById("proj-1")).toBeDefined();
    });

    it("findProjectById returns undefined for missing", () => {
      expect(findProjectById("missing")).toBeUndefined();
    });

    it("createProject creates with budget fields", () => {
      const p = createProject({
        name: "P2",
        rootPath: "/tmp/p2",
        plannerMaxBudgetUsd: 1.5,
        planCheckerMaxBudgetUsd: 0.5,
        implementerMaxBudgetUsd: 3.0,
        reviewSidecarMaxBudgetUsd: 0.3,
      });
      expect(p).toBeDefined();
      expect(p!.plannerMaxBudgetUsd).toBe(1.5);
    });

    it("updateProject updates fields", () => {
      const p = createProject({ name: "P", rootPath: "/tmp/p" });
      const updated = updateProject(p!.id, { name: "Updated", rootPath: "/tmp/updated" });
      expect(updated!.name).toBe("Updated");
      expect(updated!.rootPath).toBe("/tmp/updated");
    });

    it("deleteProject removes project", () => {
      const p = createProject({ name: "Del", rootPath: "/tmp/del" });
      deleteProject(p!.id);
      expect(findProjectById(p!.id)).toBeUndefined();
    });

    it("findProjectByTaskId returns project for task", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      expect(findProjectByTaskId(t!.id)!.id).toBe("proj-1");
    });

    it("findProjectByTaskId returns undefined for missing task", () => {
      expect(findProjectByTaskId("no-such-task")).toBeUndefined();
    });
  });

  // ── Activity / heartbeat / status ───────────────────────

  describe("appendTaskActivityLog", () => {
    it("appends to empty log", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      appendTaskActivityLog(t!.id, "line1");
      const found = findTaskById(t!.id);
      expect(found!.agentActivityLog).toBe("line1");
    });

    it("appends to existing log", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      appendTaskActivityLog(t!.id, "line1");
      appendTaskActivityLog(t!.id, "line2");
      const found = findTaskById(t!.id);
      expect(found!.agentActivityLog).toBe("line1\nline2");
    });
  });

  describe("updateTaskHeartbeat", () => {
    it("updates heartbeat timestamp", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      updateTaskHeartbeat(t!.id);
      const found = findTaskById(t!.id);
      expect(found!.lastHeartbeatAt).toBeDefined();
      expect(found!.updatedAt).toBeDefined();
    });
  });

  describe("updateTaskStatus", () => {
    it("updates status", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      updateTaskStatus(t!.id, "planning");
      expect(findTaskById(t!.id)!.status).toBe("planning");
    });

    it("updates status with extra fields", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      updateTaskStatus(t!.id, "blocked_external", {
        blockedReason: "waiting",
        blockedFromStatus: "planning",
      });
      const found = findTaskById(t!.id)!;
      expect(found.status).toBe("blocked_external");
      expect(found.blockedReason).toBe("waiting");
    });
  });

  // ── Token usage ─────────────────────────────────────────

  describe("incrementTaskTokenUsage", () => {
    it("increments token usage", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const delta = incrementTaskTokenUsage(t!.id, {
        input_tokens: 100,
        output_tokens: 50,
        total_cost_usd: 0.01,
      });
      expect(delta.input).toBe(100);
      expect(delta.output).toBe(50);
      const found = findTaskById(t!.id)!;
      expect(found.tokenInput).toBe(100);
      expect(found.tokenOutput).toBe(50);
      expect(found.tokenTotal).toBe(150);
    });

    it("skips update for zero usage", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const delta = incrementTaskTokenUsage(t!.id, {});
      expect(delta.total).toBe(0);
    });

    it("handles null usage", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const delta = incrementTaskTokenUsage(t!.id, null);
      expect(delta.total).toBe(0);
    });
  });

  // ── persistTaskPlanForTask ───────────────────────────────

  describe("persistTaskPlanForTask", () => {
    it("persists plan text for a task", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      const result = persistTaskPlanForTask({ taskId: t!.id, planText: "## Plan\n- step 1" });
      expect(result.updatedAt).toBeDefined();
      const found = findTaskById(t!.id);
      expect(found!.plan).toBe("## Plan\n- step 1");
    });

    it("clears plan with null", () => {
      const t = createTask({ projectId: "proj-1", title: "T", description: "D" });
      persistTaskPlanForTask({ taskId: t!.id, planText: "some plan" });
      persistTaskPlanForTask({ taskId: t!.id, planText: null });
      const found = findTaskById(t!.id);
      expect(found!.plan).toBe(null);
    });
  });

  // ── Coordinator candidate ────────────────────────────────

  describe("findCoordinatorTaskCandidate", () => {
    it("finds plan-checker candidates", () => {
      const db = testDb.current;
      db.insert(tasks)
        .values({
          id: "pc-task",
          projectId: "proj-1",
          title: "Plan check",
          status: "plan_ready",
          autoMode: true,
          paused: false,
        })
        .run();
      const candidate = findCoordinatorTaskCandidate("plan-checker");
      expect(candidate).toBeDefined();
      expect(candidate!.id).toBe("pc-task");
    });

    it("finds reviewer candidates", () => {
      const db = testDb.current;
      db.insert(tasks)
        .values({
          id: "rv-task",
          projectId: "proj-1",
          title: "Review",
          status: "review",
          paused: false,
        })
        .run();
      const candidate = findCoordinatorTaskCandidate("reviewer");
      expect(candidate).toBeDefined();
      expect(candidate!.id).toBe("rv-task");
    });
  });

  // ── Roadmap alias ───────────────────────────────────────

  describe("findTasksByRoadmapAlias", () => {
    it("finds tasks by roadmap alias", () => {
      createTask({
        projectId: "proj-1",
        title: "T1",
        description: "D",
        roadmapAlias: "feature-x",
      });
      createTask({
        projectId: "proj-1",
        title: "T2",
        description: "D",
        roadmapAlias: "feature-y",
      });
      expect(findTasksByRoadmapAlias("proj-1", "feature-x")).toHaveLength(1);
    });

    it("returns empty for non-matching alias", () => {
      expect(findTasksByRoadmapAlias("proj-1", "none")).toHaveLength(0);
    });
  });
});
