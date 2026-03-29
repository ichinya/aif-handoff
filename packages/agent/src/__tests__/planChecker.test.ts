import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { projects, tasks } from "@aif/shared";
import { createTestDb } from "@aif/shared/server";

const testDb = { current: createTestDb() };
const queryMock = vi.fn();

vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return {
    ...actual,
    getDb: () => testDb.current,
  };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

const { runPlanChecker } = await import("../subagents/planChecker.js");

function streamSuccess(result: string): AsyncIterable<{
  type: "result";
  subtype: "success";
  result: string;
}> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "result", subtype: "success", result };
    },
  };
}

describe("runPlanChecker", () => {
  beforeEach(() => {
    testDb.current = createTestDb();
    queryMock.mockReset();

    testDb.current
      .insert(projects)
      .values({
        id: "project-1",
        name: "Test",
        rootPath: "/tmp/plan-checker-test",
      })
      .run();
  });

  it("runs without explicit agent override", async () => {
    queryMock.mockReturnValue(streamSuccess("## Plan\n- [ ] Keep this"));

    testDb.current
      .insert(tasks)
      .values({
        id: "task-1",
        projectId: "project-1",
        title: "Task",
        description: "Desc",
        status: "plan_ready",
        plan: "## Plan\n- [ ] Existing item",
      })
      .run();

    await runPlanChecker("task-1", "/tmp/plan-checker-test");

    const call = queryMock.mock.calls[0]?.[0] as {
      options?: { extraArgs?: { agent?: string } };
    };
    expect(call.options?.extraArgs).toBeUndefined();
  });

  it("keeps existing plan when checker returns non-checklist junk", async () => {
    queryMock.mockReturnValue(
      streamSuccess(`/
├── index.html
└── .ai-factory/
    └── PLAN.md`),
    );

    testDb.current
      .insert(tasks)
      .values({
        id: "task-2",
        projectId: "project-1",
        title: "Task",
        description: "Desc",
        status: "plan_ready",
        plan: "## Good Plan\n- [ ] Step 1\n- [ ] Step 2",
      })
      .run();

    await runPlanChecker("task-2", "/tmp/plan-checker-test");

    const row = testDb.current.select().from(tasks).where(eq(tasks.id, "task-2")).get();
    expect(row?.plan).toBe("## Good Plan\n- [ ] Step 1\n- [ ] Step 2");
  });

  it("accepts fenced markdown and persists valid checklist plan", async () => {
    queryMock.mockReturnValue(
      streamSuccess("```markdown\n## Good Plan\n- [ ] Step 1\n- [x] Done\n```"),
    );

    testDb.current
      .insert(tasks)
      .values({
        id: "task-3",
        projectId: "project-1",
        title: "Task",
        description: "Desc",
        status: "plan_ready",
        plan: "## Good Plan\n- [ ] Step 1\n- [ ] Done",
      })
      .run();

    await runPlanChecker("task-3", "/tmp/plan-checker-test");

    const row = testDb.current.select().from(tasks).where(eq(tasks.id, "task-3")).get();
    expect(row?.plan).toBe("## Good Plan\n- [ ] Step 1\n- [x] Done");
  });

  it("writes plan file to custom planPath instead of default PLAN.md", async () => {
    const projectRoot = join("/tmp", `plan-checker-planpath-${Date.now()}`);
    mkdirSync(projectRoot, { recursive: true });

    queryMock.mockReturnValue(streamSuccess("## Custom\n- [ ] Step 1\n- [x] Done"));

    testDb.current
      .insert(projects)
      .values({
        id: "project-planpath",
        name: "PlanPath Test",
        rootPath: projectRoot,
      })
      .run();

    testDb.current
      .insert(tasks)
      .values({
        id: "task-planpath",
        projectId: "project-planpath",
        title: "Task with planPath",
        description: "Desc",
        status: "plan_ready",
        plan: "## Custom\n- [ ] Step 1\n- [ ] Done",
        planPath: "docs/MY_PLAN.md",
      })
      .run();

    await runPlanChecker("task-planpath", projectRoot);

    const customPlanFile = join(projectRoot, "docs/MY_PLAN.md");
    const defaultPlanFile = join(projectRoot, ".ai-factory/PLAN.md");

    expect(existsSync(customPlanFile)).toBe(true);
    expect(existsSync(defaultPlanFile)).toBe(false);

    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("writes plan to FIX_PLAN.md when task.isFix is true", async () => {
    const projectRoot = join("/tmp", `plan-checker-fix-${Date.now()}`);
    mkdirSync(projectRoot, { recursive: true });

    queryMock.mockReturnValue(streamSuccess("## Fix\n- [ ] Patch bug\n- [x] Done"));

    testDb.current
      .insert(projects)
      .values({
        id: "project-fix",
        name: "Fix Test",
        rootPath: projectRoot,
      })
      .run();

    testDb.current
      .insert(tasks)
      .values({
        id: "task-fix",
        projectId: "project-fix",
        title: "Fix task",
        description: "Desc",
        status: "plan_ready",
        plan: "## Fix\n- [ ] Patch bug\n- [ ] Done",
        isFix: true,
      })
      .run();

    await runPlanChecker("task-fix", projectRoot);

    const fixPlanFile = join(projectRoot, ".ai-factory/FIX_PLAN.md");
    const defaultPlanFile = join(projectRoot, ".ai-factory/PLAN.md");

    expect(existsSync(fixPlanFile)).toBe(true);
    expect(existsSync(defaultPlanFile)).toBe(false);

    rmSync(projectRoot, { recursive: true, force: true });
  });
});
