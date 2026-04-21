import { describe, it, expect, beforeEach, vi } from "vitest";
import { projects } from "@aif/shared";
import { createTestDb } from "@aif/shared/server";

const testDb = { current: createTestDb() };
vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return {
    ...actual,
    getDb: () => testDb.current,
  };
});

const dataModule = await import("../index.js");

const {
  createProject,
  findProjectById,
  createTask,
  findTaskById,
  createChatSession,
  findChatSessionById,
  createRuntimeProfile,
  findRuntimeProfileById,
  updateRuntimeProfile,
  deleteRuntimeProfile,
  listRuntimeProfiles,
  toRuntimeProfileResponse,
  updateProjectRuntimeDefaults,
  updateTaskRuntimeOverride,
  updateChatSessionRuntime,
  resolveEffectiveRuntimeProfile,
} = dataModule;

const dataModuleWithAppSettings = dataModule as unknown as {
  getAppSettings?: () => {
    id: number;
    defaultTaskRuntimeProfileId: string | null;
    defaultPlanRuntimeProfileId: string | null;
    defaultReviewRuntimeProfileId: string | null;
    defaultChatRuntimeProfileId: string | null;
  };
  updateAppSettings?: (input: {
    defaultTaskRuntimeProfileId?: string | null;
    defaultPlanRuntimeProfileId?: string | null;
    defaultReviewRuntimeProfileId?: string | null;
    defaultChatRuntimeProfileId?: string | null;
  }) => {
    id: number;
    defaultTaskRuntimeProfileId: string | null;
    defaultPlanRuntimeProfileId: string | null;
    defaultReviewRuntimeProfileId: string | null;
    defaultChatRuntimeProfileId: string | null;
  } | undefined;
  isRuntimeProfileVisibleToProject?: (input: {
    projectId: string;
    runtimeProfileId: string | null;
  }) => boolean;
  isRuntimeProfileEligibleForAppDefaults?: (runtimeProfileId: string | null) => boolean;
  getAppDefaultRuntimeProfileId?: (mode: "task" | "plan" | "review" | "chat") => string | null;
};

function seedProject(id = "proj-1") {
  testDb.current
    .insert(projects)
    .values({ id, name: "Test", rootPath: "/tmp/test" })
    .run();
}

describe("runtime profiles data layer", () => {
  beforeEach(() => {
    testDb.current = createTestDb();
    seedProject();
  });

  it("creates and maps runtime profiles", () => {
    const profile = createRuntimeProfile({
      projectId: "proj-1",
      name: "Claude Default",
      runtimeId: "claude",
      providerId: "anthropic",
      transport: "sdk",
      headers: { "x-org": "aif" },
      options: { timeoutMs: 1000 },
      enabled: true,
    });

    expect(profile).toBeDefined();
    const mapped = toRuntimeProfileResponse(profile!);
    expect(mapped.projectId).toBe("proj-1");
    expect(mapped.runtimeId).toBe("claude");
    expect(mapped.headers).toEqual({ "x-org": "aif" });
    expect(mapped.options).toEqual({ timeoutMs: 1000 });
  });

  it("updates runtime profiles", () => {
    const profile = createRuntimeProfile({
      name: "Codex",
      runtimeId: "codex",
      providerId: "openai",
      enabled: true,
    });

    const updated = updateRuntimeProfile(profile!.id, {
      defaultModel: "gpt-5.4",
      enabled: false,
      options: { mode: "cli" },
    });

    expect(updated).toBeDefined();
    expect(updated!.defaultModel).toBe("gpt-5.4");
    expect(updated!.enabled).toBe(false);
    expect(toRuntimeProfileResponse(updated!).options).toEqual({ mode: "cli" });
  });

  it("lists runtime profiles with global fallback", () => {
    createRuntimeProfile({
      projectId: "proj-1",
      name: "Project Profile",
      runtimeId: "claude",
      providerId: "anthropic",
    });
    createRuntimeProfile({
      projectId: null,
      name: "Global Profile",
      runtimeId: "codex",
      providerId: "openai",
    });

    const scoped = listRuntimeProfiles({ projectId: "proj-1" });
    const withGlobal = listRuntimeProfiles({ projectId: "proj-1", includeGlobal: true });

    expect(scoped).toHaveLength(1);
    expect(withGlobal).toHaveLength(2);
  });

  it("updates runtime defaults and overrides for project/task/chat", () => {
    const profile = createRuntimeProfile({
      projectId: "proj-1",
      name: "Default",
      runtimeId: "claude",
      providerId: "anthropic",
    });
    const project = updateProjectRuntimeDefaults("proj-1", {
      defaultTaskRuntimeProfileId: profile!.id,
      defaultChatRuntimeProfileId: profile!.id,
    });
    expect(project?.defaultTaskRuntimeProfileId).toBe(profile!.id);
    expect(project?.defaultChatRuntimeProfileId).toBe(profile!.id);

    const task = createTask({ projectId: "proj-1", title: "T", description: "D" });
    updateTaskRuntimeOverride(task!.id, {
      runtimeProfileId: profile!.id,
      modelOverride: "claude-sonnet",
      runtimeOptions: { approval: "never" },
    });
    const taskAfter = findTaskById(task!.id);
    expect(taskAfter?.runtimeProfileId).toBe(profile!.id);
    expect(taskAfter?.modelOverride).toBe("claude-sonnet");
    expect(taskAfter?.runtimeOptionsJson).toBe(JSON.stringify({ approval: "never" }));

    const chat = createChatSession({ projectId: "proj-1" });
    updateChatSessionRuntime(chat!.id, {
      runtimeProfileId: profile!.id,
      runtimeSessionId: "runtime-session-1",
    });
    const chatAfter = findChatSessionById(chat!.id);
    expect(chatAfter?.runtimeProfileId).toBe(profile!.id);
    expect(chatAfter?.runtimeSessionId).toBe("runtime-session-1");
  });

  it("persists singleton app-wide runtime defaults", () => {
    const globalProfile = createRuntimeProfile({
      projectId: null,
      name: "Global Default",
      runtimeId: "codex",
      providerId: "openai",
      enabled: true,
    });

    const getAppSettings = dataModuleWithAppSettings.getAppSettings;
    const updateAppSettings = dataModuleWithAppSettings.updateAppSettings;

    expect(getAppSettings).toBeTypeOf("function");
    expect(updateAppSettings).toBeTypeOf("function");
    if (!getAppSettings || !updateAppSettings) return;

    expect(getAppSettings()).toMatchObject({
      id: 1,
      defaultTaskRuntimeProfileId: null,
      defaultPlanRuntimeProfileId: null,
      defaultReviewRuntimeProfileId: null,
      defaultChatRuntimeProfileId: null,
    });

    const updated = updateAppSettings({
      defaultTaskRuntimeProfileId: globalProfile!.id,
      defaultPlanRuntimeProfileId: globalProfile!.id,
      defaultReviewRuntimeProfileId: globalProfile!.id,
      defaultChatRuntimeProfileId: globalProfile!.id,
    });

    expect(updated).toMatchObject({
      id: 1,
      defaultTaskRuntimeProfileId: globalProfile!.id,
      defaultPlanRuntimeProfileId: globalProfile!.id,
      defaultReviewRuntimeProfileId: globalProfile!.id,
      defaultChatRuntimeProfileId: globalProfile!.id,
    });
    expect(getAppSettings()).toMatchObject({
      id: 1,
      defaultTaskRuntimeProfileId: globalProfile!.id,
      defaultPlanRuntimeProfileId: globalProfile!.id,
      defaultReviewRuntimeProfileId: globalProfile!.id,
      defaultChatRuntimeProfileId: globalProfile!.id,
    });
  });

  it("validates runtime profile scope for project visibility and app-default eligibility", () => {
    seedProject("proj-2");
    const globalProfile = createRuntimeProfile({
      projectId: null,
      name: "Global",
      runtimeId: "codex",
      providerId: "openai",
      enabled: true,
    });
    const projectProfile = createRuntimeProfile({
      projectId: "proj-1",
      name: "Project",
      runtimeId: "claude",
      providerId: "anthropic",
      enabled: true,
    });
    const foreignProjectProfile = createRuntimeProfile({
      projectId: "proj-2",
      name: "Foreign",
      runtimeId: "claude",
      providerId: "anthropic",
      enabled: true,
    });
    const disabledGlobalProfile = createRuntimeProfile({
      projectId: null,
      name: "Disabled Global",
      runtimeId: "codex",
      providerId: "openai",
      enabled: false,
    });

    const isRuntimeProfileVisibleToProject =
      dataModuleWithAppSettings.isRuntimeProfileVisibleToProject;
    const isRuntimeProfileEligibleForAppDefaults =
      dataModuleWithAppSettings.isRuntimeProfileEligibleForAppDefaults;

    expect(isRuntimeProfileVisibleToProject).toBeTypeOf("function");
    expect(isRuntimeProfileEligibleForAppDefaults).toBeTypeOf("function");
    if (!isRuntimeProfileVisibleToProject || !isRuntimeProfileEligibleForAppDefaults) return;

    expect(
      isRuntimeProfileVisibleToProject({
        projectId: "proj-1",
        runtimeProfileId: globalProfile!.id,
      }),
    ).toBe(true);
    expect(
      isRuntimeProfileVisibleToProject({
        projectId: "proj-1",
        runtimeProfileId: projectProfile!.id,
      }),
    ).toBe(true);
    expect(
      isRuntimeProfileVisibleToProject({
        projectId: "proj-1",
        runtimeProfileId: foreignProjectProfile!.id,
      }),
    ).toBe(false);

    expect(isRuntimeProfileEligibleForAppDefaults(globalProfile!.id)).toBe(true);
    expect(isRuntimeProfileEligibleForAppDefaults(projectProfile!.id)).toBe(false);
    expect(isRuntimeProfileEligibleForAppDefaults(disabledGlobalProfile!.id)).toBe(false);
  });

  it("resolves app default runtime ids with plan and review fallback to task", () => {
    const globalTaskProfile = createRuntimeProfile({
      projectId: null,
      name: "Global Task",
      runtimeId: "claude",
      providerId: "anthropic",
      enabled: true,
    });
    const globalChatProfile = createRuntimeProfile({
      projectId: null,
      name: "Global Chat",
      runtimeId: "codex",
      providerId: "openai",
      enabled: true,
    });

    const updateAppSettings = dataModuleWithAppSettings.updateAppSettings;
    const getAppDefaultRuntimeProfileId = dataModuleWithAppSettings.getAppDefaultRuntimeProfileId;

    expect(updateAppSettings).toBeTypeOf("function");
    expect(getAppDefaultRuntimeProfileId).toBeTypeOf("function");
    if (!updateAppSettings || !getAppDefaultRuntimeProfileId) return;

    updateAppSettings({
      defaultTaskRuntimeProfileId: globalTaskProfile!.id,
      defaultPlanRuntimeProfileId: null,
      defaultReviewRuntimeProfileId: null,
      defaultChatRuntimeProfileId: globalChatProfile!.id,
    });

    expect(getAppDefaultRuntimeProfileId("task")).toBe(globalTaskProfile!.id);
    expect(getAppDefaultRuntimeProfileId("plan")).toBe(globalTaskProfile!.id);
    expect(getAppDefaultRuntimeProfileId("review")).toBe(globalTaskProfile!.id);
    expect(getAppDefaultRuntimeProfileId("chat")).toBe(globalChatProfile!.id);
  });

  it("skips unavailable app defaults and keeps task fallback for plan/review", () => {
    const globalTaskProfile = createRuntimeProfile({
      projectId: null,
      name: "Global Task",
      runtimeId: "claude",
      providerId: "anthropic",
      enabled: true,
    });
    const disabledPlanProfile = createRuntimeProfile({
      projectId: null,
      name: "Disabled Plan",
      runtimeId: "codex",
      providerId: "openai",
      enabled: false,
    });
    const disabledReviewProfile = createRuntimeProfile({
      projectId: null,
      name: "Disabled Review",
      runtimeId: "codex",
      providerId: "openai",
      enabled: false,
    });
    const disabledChatProfile = createRuntimeProfile({
      projectId: null,
      name: "Disabled Chat",
      runtimeId: "codex",
      providerId: "openai",
      enabled: false,
    });

    const updateAppSettings = dataModuleWithAppSettings.updateAppSettings;
    const getAppDefaultRuntimeProfileId = dataModuleWithAppSettings.getAppDefaultRuntimeProfileId;

    expect(updateAppSettings).toBeTypeOf("function");
    expect(getAppDefaultRuntimeProfileId).toBeTypeOf("function");
    if (!updateAppSettings || !getAppDefaultRuntimeProfileId) return;

    updateAppSettings({
      defaultTaskRuntimeProfileId: globalTaskProfile!.id,
      defaultPlanRuntimeProfileId: disabledPlanProfile!.id,
      defaultReviewRuntimeProfileId: disabledReviewProfile!.id,
      defaultChatRuntimeProfileId: disabledChatProfile!.id,
    });

    expect(getAppDefaultRuntimeProfileId("task")).toBe(globalTaskProfile!.id);
    expect(getAppDefaultRuntimeProfileId("plan")).toBe(globalTaskProfile!.id);
    expect(getAppDefaultRuntimeProfileId("review")).toBe(globalTaskProfile!.id);
    expect(getAppDefaultRuntimeProfileId("chat")).toBeNull();
  });

  it("invalidates cached app settings after runtime profile deletion trigger clears defaults", () => {
    const globalProfile = createRuntimeProfile({
      projectId: null,
      name: "Global Default",
      runtimeId: "codex",
      providerId: "openai",
      enabled: true,
    });

    const getAppSettings = dataModuleWithAppSettings.getAppSettings;
    const updateAppSettings = dataModuleWithAppSettings.updateAppSettings;

    expect(getAppSettings).toBeTypeOf("function");
    expect(updateAppSettings).toBeTypeOf("function");
    if (!getAppSettings || !updateAppSettings) return;

    updateAppSettings({
      defaultTaskRuntimeProfileId: globalProfile!.id,
      defaultPlanRuntimeProfileId: globalProfile!.id,
      defaultReviewRuntimeProfileId: globalProfile!.id,
      defaultChatRuntimeProfileId: globalProfile!.id,
    });

    expect(getAppSettings()).toMatchObject({
      defaultTaskRuntimeProfileId: globalProfile!.id,
      defaultPlanRuntimeProfileId: globalProfile!.id,
      defaultReviewRuntimeProfileId: globalProfile!.id,
      defaultChatRuntimeProfileId: globalProfile!.id,
    });

    deleteRuntimeProfile(globalProfile!.id);

    expect(getAppSettings()).toMatchObject({
      defaultTaskRuntimeProfileId: null,
      defaultPlanRuntimeProfileId: null,
      defaultReviewRuntimeProfileId: null,
      defaultChatRuntimeProfileId: null,
    });
  });

  it("resolves task override first", () => {
    const projectDefault = createRuntimeProfile({
      projectId: "proj-1",
      name: "Project Default",
      runtimeId: "claude",
      providerId: "anthropic",
    });
    const override = createRuntimeProfile({
      projectId: "proj-1",
      name: "Task Override",
      runtimeId: "codex",
      providerId: "openai",
    });

    createProject({
      name: "Other",
      rootPath: "/tmp/other",
      defaultTaskRuntimeProfileId: projectDefault!.id,
    });

    const task = createTask({
      projectId: "proj-1",
      title: "Resolve",
      description: "Test",
      runtimeProfileId: override!.id,
    });

    const resolved = resolveEffectiveRuntimeProfile({ taskId: task!.id });
    expect(resolved.source).toBe("task_override");
    expect(resolved.profile?.id).toBe(override!.id);
  });

  it("falls back to project default when task override is unavailable", () => {
    const unavailableOverride = createRuntimeProfile({
      projectId: "proj-1",
      name: "Disabled Override",
      runtimeId: "codex",
      providerId: "openai",
      enabled: false,
    });
    const projectDefault = createRuntimeProfile({
      projectId: "proj-1",
      name: "Project Default",
      runtimeId: "claude",
      providerId: "anthropic",
      enabled: true,
    });

    updateProjectRuntimeDefaults("proj-1", {
      defaultTaskRuntimeProfileId: projectDefault!.id,
    });

    const task = createTask({
      projectId: "proj-1",
      title: "Fallback",
      description: "Test",
      runtimeProfileId: unavailableOverride!.id,
    });

    const resolved = resolveEffectiveRuntimeProfile({
      taskId: task!.id,
      systemDefaultRuntimeProfileId: null,
    });
    expect(resolved.source).toBe("project_default");
    expect(resolved.profile?.id).toBe(projectDefault!.id);
  });

  it("falls back to system default when task/project defaults are missing", () => {
    const systemDefault = createRuntimeProfile({
      projectId: null,
      name: "System Default",
      runtimeId: "codex",
      providerId: "openai",
      enabled: true,
    });

    const task = createTask({
      projectId: "proj-1",
      title: "System fallback",
      description: "Test",
    });

    const resolved = resolveEffectiveRuntimeProfile({
      taskId: task!.id,
      systemDefaultRuntimeProfileId: systemDefault!.id,
    });
    expect(resolved.source).toBe("system_default");
    expect(resolved.profile?.id).toBe(systemDefault!.id);
  });

  it("returns none when no profile is available", () => {
    const task = createTask({
      projectId: "proj-1",
      title: "No runtime",
      description: "Test",
    });

    const resolved = resolveEffectiveRuntimeProfile({
      taskId: task!.id,
      systemDefaultRuntimeProfileId: null,
    });
    expect(resolved.source).toBe("none");
    expect(resolved.profile).toBeNull();
  });

  it("deletes runtime profiles", () => {
    const created = createRuntimeProfile({
      name: "Delete me",
      runtimeId: "claude",
      providerId: "anthropic",
    });
    expect(findRuntimeProfileById(created!.id)).toBeDefined();
    deleteRuntimeProfile(created!.id);
    expect(findRuntimeProfileById(created!.id)).toBeUndefined();
  });

  it("persists runtime defaults when creating a project", () => {
    const profile = createRuntimeProfile({
      name: "Default",
      runtimeId: "claude",
      providerId: "anthropic",
    });
    const project = createProject({
      name: "With defaults",
      rootPath: "/tmp/with-defaults",
      defaultTaskRuntimeProfileId: profile!.id,
      defaultChatRuntimeProfileId: profile!.id,
      defaultPlanRuntimeProfileId: profile!.id,
      defaultReviewRuntimeProfileId: profile!.id,
    } as Parameters<typeof createProject>[0] & {
      defaultPlanRuntimeProfileId: string;
      defaultReviewRuntimeProfileId: string;
    });

    const found = findProjectById(project!.id);
    expect(found?.defaultTaskRuntimeProfileId).toBe(profile!.id);
    expect(found?.defaultPlanRuntimeProfileId).toBe(profile!.id);
    expect(found?.defaultReviewRuntimeProfileId).toBe(profile!.id);
    expect(found?.defaultChatRuntimeProfileId).toBe(profile!.id);
  });
});
