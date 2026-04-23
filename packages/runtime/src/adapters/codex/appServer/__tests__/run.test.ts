import { once } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeTransport, UsageSource, type RuntimeRunInput } from "../../../../types.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url),
);

const activeChildren = new Set<ChildProcessWithoutNullStreams>();

const spawnCodexAppServerProcessMock = vi.fn();
const terminateCodexAppServerProcessMock = vi.fn();

vi.mock("../process.js", () => ({
  spawnCodexAppServerProcess: (...args: unknown[]) => spawnCodexAppServerProcessMock(...args),
  terminateCodexAppServerProcess: (...args: unknown[]) =>
    terminateCodexAppServerProcessMock(...args),
}));

const { runCodexAppServer } = await import("../run.js");

function spawnFixtureProcess(scenario: string): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [FIXTURE_PATH], {
    stdio: "pipe",
    env: {
      ...process.env,
      FAKE_CODEX_SCENARIO: scenario,
    },
  });
  activeChildren.add(child);
  return child;
}

async function terminateFixtureProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  activeChildren.delete(child);
  if (child.exitCode != null) {
    return;
  }
  child.kill();
  await once(child, "exit").catch(() => undefined);
}

function createRunInput(
  overrides: Partial<RuntimeRunInput> = {},
  scenario = "run-success",
): RuntimeRunInput {
  return {
    runtimeId: "codex",
    providerId: "openai",
    profileId: "profile-1",
    workflowKind: "chat",
    transport: RuntimeTransport.APP_SERVER,
    prompt: "Hello from test",
    options: {
      testScenario: scenario,
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    },
    usageContext: {
      source: UsageSource.CHAT,
      projectId: "project-1",
      chatSessionId: "chat-1",
    },
    execution: {
      startTimeoutMs: 500,
      runTimeoutMs: 5_000,
    },
    ...overrides,
  };
}

beforeEach(() => {
  spawnCodexAppServerProcessMock.mockReset();
  terminateCodexAppServerProcessMock.mockReset();

  spawnCodexAppServerProcessMock.mockImplementation(
    (input: {
      input: {
        options?: Record<string, unknown>;
        cwd?: string;
        projectRoot?: string;
      };
    }) => {
      const scenario =
        typeof input.input.options?.testScenario === "string"
          ? input.input.options.testScenario
          : "run-success";
      const child = spawnFixtureProcess(scenario);
      const stderrTail: string[] = [];
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderrTail.push(String(chunk));
        while (stderrTail.length > 50) {
          stderrTail.shift();
        }
      });
      return {
        process: child,
        stderrTail,
        executablePath: process.execPath,
        args: [FIXTURE_PATH],
        cwd: input.input.cwd ?? input.input.projectRoot,
      };
    },
  );

  terminateCodexAppServerProcessMock.mockImplementation(
    async (context: { process: ChildProcessWithoutNullStreams }) => {
      await terminateFixtureProcess(context.process);
    },
  );
});

afterEach(async () => {
  await Promise.all([...activeChildren].map((child) => terminateFixtureProcess(child)));
});

describe("codex app-server run transport", () => {
  it("accumulates streamed output and usage from turn notifications", async () => {
    const observedEvents: string[] = [];
    const result = await runCodexAppServer(
      createRunInput({
        execution: {
          startTimeoutMs: 500,
          runTimeoutMs: 5_000,
          onEvent: (event) => {
            observedEvents.push(event.type);
          },
        },
      }),
    );

    expect(result.sessionId).toBe("thread-1");
    expect(result.outputText).toContain("Hello from fake app-server");
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });
    expect(observedEvents).toContain("system:init");
    expect(observedEvents).toContain("stream:text");
    expect(observedEvents).toContain("result:success");
  });

  it("uses thread/resume for resumed turns and keeps the existing thread id", async () => {
    const result = await runCodexAppServer(
      createRunInput(
        {
          sessionId: "thread-resume-42",
          resume: true,
        },
        "resume-required",
      ),
    );

    expect(result.sessionId).toBe("thread-resume-42");
    expect(result.outputText).toContain("Hello from fake app-server");
  });

  it("sends turn/interrupt when AbortController is triggered", async () => {
    const abortController = new AbortController();
    const runPromise = runCodexAppServer(
      createRunInput(
        {
          execution: {
            startTimeoutMs: 500,
            runTimeoutMs: 5_000,
            abortController,
            onEvent: (event) => {
              if (event.type === "turn:started") {
                abortController.abort();
              }
            },
          },
        },
        "requires-interrupt",
      ),
    );

    const result = await runPromise;
    expect(result.outputText).toContain("Interrupted by client");
    expect(result.sessionId).toBe("thread-1");
  }, 15_000);

  it("sends deferred turn/interrupt when abort happens before turn id is known", async () => {
    const abortController = new AbortController();
    const runPromise = runCodexAppServer(
      createRunInput(
        {
          execution: {
            startTimeoutMs: 500,
            runTimeoutMs: 5_000,
            abortController,
          },
        },
        "delayed-turn-start-requires-interrupt",
      ),
    );
    setTimeout(() => abortController.abort(), 10);

    const result = await runPromise;
    expect(result.outputText).toContain("Interrupted by client");
    expect(result.sessionId).toBe("thread-1");
  }, 15_000);

  it("honors an AbortController that was already aborted before listener registration", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const result = await runCodexAppServer(
      createRunInput(
        {
          execution: {
            startTimeoutMs: 500,
            runTimeoutMs: 5_000,
            abortController,
          },
        },
        "requires-interrupt",
      ),
    );

    expect(result.outputText).toContain("Interrupted by client");
    expect(result.sessionId).toBe("thread-1");
  }, 15_000);

  it("fails active run immediately on malformed JSONL during notification streaming", async () => {
    await expect(
      runCodexAppServer(createRunInput({}, "malformed-after-turn-start")),
    ).rejects.toThrow("Malformed JSONL RPC payload from Codex app-server");
  });

  it("normalizes structured turn failures into runtime adapter errors", async () => {
    await expect(runCodexAppServer(createRunInput({}, "turn-failed"))).rejects.toMatchObject({
      message: "simulated turn failure",
      adapterCode: "CODEX_TRANSPORT_ERROR",
      category: "transport",
    });
  });
});
