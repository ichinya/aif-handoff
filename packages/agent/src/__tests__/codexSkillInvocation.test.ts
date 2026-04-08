import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, runtimeProfiles, tasks } from "@aif/shared";
import { createTestDb } from "@aif/shared/server";
import type { RuntimeRunInput } from "@aif/runtime";

const testDb = { current: createTestDb() };
const codexRunInputs: RuntimeRunInput[] = [];
const logActivityMock = vi.fn();
const incrementTaskTokenUsageMock = vi.fn();
const saveTaskSessionIdMock = vi.fn();
const getTaskSessionIdMock = vi.fn(() => null);
const updateTaskHeartbeatMock = vi.fn();
const renewTaskClaimMock = vi.fn();

const codexCapabilities = {
  supportsResume: true,
  supportsSessionList: true,
  supportsAgentDefinitions: false,
  supportsStreaming: true,
  supportsModelDiscovery: true,
  supportsApprovals: false,
  supportsCustomEndpoint: true,
} as const;

const fakeCodexAdapter = {
  descriptor: {
    id: "codex",
    providerId: "openai",
    displayName: "Codex",
    capabilities: codexCapabilities,
    defaultTransport: "sdk",
    supportedTransports: ["sdk", "cli", "api"],
    defaultModelPlaceholder: "gpt-5.4",
    lightModel: null,
  },
  getEffectiveCapabilities() {
    return codexCapabilities;
  },
  async run(input: RuntimeRunInput) {
    codexRunInputs.push(input);
    switch (input.workflowKind) {
      case "planner":
        return { outputText: "## Codex Plan\n- [ ] Step" };
      case "implementer":
        return { outputText: "Implementation done" };
      case "implementer_checklist_sync":
        return { outputText: "## Plan\n- [x] Task 1: Pending" };
      case "reviewer":
        return { outputText: "Review OK" };
      case "review-security":
        return { outputText: "Security OK" };
      default:
        return { outputText: "OK" };
    }
  },
};

const fakeRegistry = {
  resolveRuntime(runtimeId: string) {
    if (runtimeId !== "codex") {
      throw new Error(`Unexpected runtime: ${runtimeId}`);
    }
    return fakeCodexAdapter;
  },
  tryResolveRuntime(runtimeId: string) {
    return runtimeId === "codex" ? fakeCodexAdapter : null;
  },
  listRuntimes() {
    return [fakeCodexAdapter.descriptor];
  },
};

vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return {
    ...actual,
    getDb: () => testDb.current,
  };
});

vi.mock("@aif/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/data")>();
  return {
    ...actual,
    incrementTaskTokenUsage: incrementTaskTokenUsageMock,
    saveTaskSessionId: saveTaskSessionIdMock,
    getTaskSessionId: getTaskSessionIdMock,
    updateTaskHeartbeat: updateTaskHeartbeatMock,
    renewTaskClaim: renewTaskClaimMock,
  };
});

vi.mock("@aif/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared")>();
  return {
    ...actual,
    getEnv: () => ({
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      ANTHROPIC_BASE_URL: undefined,
      ANTHROPIC_MODEL: undefined,
      OPENAI_API_KEY: undefined,
      OPENAI_BASE_URL: undefined,
      OPENAI_MODEL: "gpt-5.3-codex",
      CODEX_CLI_PATH: "/usr/local/bin/codex",
      AIF_RUNTIME_MODULES: [],
      AIF_DEFAULT_RUNTIME_ID: "codex",
      AIF_DEFAULT_PROVIDER_ID: "openai",
      PORT: 3009,
      POLL_INTERVAL_MS: 30000,
      AGENT_STAGE_STALE_TIMEOUT_MS: 90 * 60 * 1000,
      AGENT_STAGE_STALE_MAX_RETRY: 3,
      AGENT_STAGE_RUN_TIMEOUT_MS: 60 * 60 * 1000,
      AGENT_QUERY_START_TIMEOUT_MS: 60 * 1000,
      AGENT_QUERY_START_RETRY_DELAY_MS: 1000,
      DATABASE_URL: "./data/aif.sqlite",
      CORS_ORIGIN: "*",
      API_BASE_URL: "http://localhost:3009",
      AGENT_QUERY_AUDIT_ENABLED: false,
      LOG_LEVEL: "debug",
      ACTIVITY_LOG_MODE: "sync",
      ACTIVITY_LOG_BATCH_SIZE: 20,
      ACTIVITY_LOG_BATCH_MAX_AGE_MS: 5000,
      ACTIVITY_LOG_QUEUE_LIMIT: 500,
      AGENT_WAKE_ENABLED: true,
      AGENT_BYPASS_PERMISSIONS: true,
      COORDINATOR_MAX_CONCURRENT_TASKS: 3,
      AGENT_MAX_REVIEW_ITERATIONS: 3,
      AGENT_USE_SUBAGENTS: true,
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_USER_ID: undefined,
    }),
    logger: () => ({
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    }),
  };
});

vi.mock("@aif/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/runtime")>();
  return {
    ...actual,
    bootstrapRuntimeRegistry: vi.fn(async () => fakeRegistry),
  };
});

vi.mock("../hooks.js", () => ({
  logActivity: logActivityMock,
}));

vi.mock("../queryAudit.js", () => ({
  writeQueryAudit: () => undefined,
}));

vi.mock("../stderrCollector.js", () => ({
  createStderrCollector: () => ({
    onStderr: () => undefined,
    getTail: () => "",
  }),
}));

const { runPlanner } = await import("../subagents/planner.js");
const { runImplementer } = await import("../subagents/implementer.js");
const { runReviewer } = await import("../subagents/reviewer.js");

describe("Codex skill invocation flow", () => {
  let projectRoot: string;

  beforeEach(() => {
    testDb.current = createTestDb();
    codexRunInputs.length = 0;
    logActivityMock.mockReset();
    incrementTaskTokenUsageMock.mockReset();
    saveTaskSessionIdMock.mockReset();
    getTaskSessionIdMock.mockReset();
    updateTaskHeartbeatMock.mockReset();
    renewTaskClaimMock.mockReset();
    getTaskSessionIdMock.mockReturnValue(null);

    projectRoot = mkdtempSync(join(tmpdir(), "aif-codex-skill-flow-"));

    testDb.current
      .insert(runtimeProfiles)
      .values({
        id: "codex-profile",
        projectId: "project-1",
        name: "Codex SDK",
        runtimeId: "codex",
        providerId: "openai",
        transport: "sdk",
        defaultModel: "gpt-5.3-codex",
        headersJson: "{}",
        optionsJson: "{}",
        enabled: true,
      })
      .run();

    testDb.current
      .insert(projects)
      .values({
        id: "project-1",
        name: "Codex Project",
        rootPath: projectRoot,
        defaultTaskRuntimeProfileId: "codex-profile",
        defaultPlanRuntimeProfileId: "codex-profile",
        defaultReviewRuntimeProfileId: "codex-profile",
        defaultChatRuntimeProfileId: "codex-profile",
      })
      .run();
  });

  it("renders $aif-plan in planner skill mode for Codex", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "planner-skill",
        projectId: "project-1",
        title: "Planner skill",
        description: "Desc",
        status: "planning",
        planPath: ".ai-factory/PLAN.md",
        useSubagents: false,
      })
      .run();

    await runPlanner("planner-skill", projectRoot);

    expect(codexRunInputs).toHaveLength(1);
    expect(codexRunInputs[0]?.prompt).toContain(
      "$aif-plan fast @.ai-factory/PLAN.md docs:false tests:false",
    );
    expect(codexRunInputs[0]?.prompt).not.toContain("/aif-plan");
  });

  it("renders $aif-plan as fallback when subagents are requested on Codex", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "planner-fallback",
        projectId: "project-1",
        title: "Planner fallback",
        description: "Desc",
        status: "planning",
        planPath: ".ai-factory/PLAN.md",
        useSubagents: true,
      })
      .run();

    await runPlanner("planner-fallback", projectRoot);

    expect(codexRunInputs).toHaveLength(1);
    expect(codexRunInputs[0]?.prompt).toContain(
      "$aif-plan fast @.ai-factory/PLAN.md docs:false tests:false",
    );
    expect(codexRunInputs[0]?.execution?.agentDefinitionName).toBeUndefined();
  });

  it("renders $aif-implement in implementer skill mode for Codex", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "implementer-skill",
        projectId: "project-1",
        title: "Implementer skill",
        description: "Desc",
        status: "implementing",
        plan: "## Plan\n- [ ] Task 1: Pending",
        useSubagents: false,
      })
      .run();

    await runImplementer("implementer-skill", projectRoot);

    expect(codexRunInputs[0]?.prompt).toContain("$aif-implement @.ai-factory/PLAN.md");
    expect(codexRunInputs[0]?.prompt).not.toContain("/aif-implement");
  });

  it("renders $aif-review and $aif-security-checklist for Codex review skill mode", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "review-skill",
        projectId: "project-1",
        title: "Review skill",
        description: "Desc",
        status: "review",
        implementationLog: "Done",
        useSubagents: false,
      })
      .run();

    await runReviewer("review-skill", projectRoot);

    const prompts = codexRunInputs.map((input) => input.prompt);
    expect(prompts.some((prompt) => prompt.includes("$aif-review"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("$aif-security-checklist"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("/aif-review"))).toBe(false);
    expect(prompts.some((prompt) => prompt.includes("/aif-security-checklist"))).toBe(false);

    const updatedTask = testDb.current
      .select()
      .from(tasks)
      .where(eq(tasks.id, "review-skill"))
      .get();
    expect(updatedTask?.reviewComments).toContain("## Code Review");
    expect(updatedTask?.reviewComments).toContain("Review OK");
    expect(updatedTask?.reviewComments).toContain("Security OK");
  });
});
