import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCodexAppServerDiscoveryEnv,
  startCodexAppServerWithRetry,
} from "../adapters/codex/modelDiscovery.js";

function createModelDiscoveryInput() {
  return {
    runtimeId: "codex",
    providerId: "openai",
    profileId: "profile-1",
    options: {},
  };
}

describe("codex app-server model discovery env", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not forward ambient OPENAI_BASE_URL into app-server discovery env", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    vi.stubEnv("OPENAI_BASE_URL", "https://deprecated.example.com/v1");
    vi.stubEnv("npm_config_registry", "https://registry.npmjs.org");

    const env = buildCodexAppServerDiscoveryEnv({
      runtimeId: "codex",
      providerId: "openai",
      profileId: "profile-1",
      options: {},
    });

    expect(env.OPENAI_API_KEY).toBe("sk-env");
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.npm_config_registry).toBeUndefined();
  });

  it("maps an explicit discovery baseUrl to CODEX_BASE_URL only", () => {
    vi.stubEnv("OPENAI_BASE_URL", "https://deprecated.example.com/v1");

    const env = buildCodexAppServerDiscoveryEnv({
      runtimeId: "codex",
      providerId: "openai",
      profileId: "profile-1",
      baseUrl: "https://runtime.example.com/v1",
      options: {},
    });

    expect(env.CODEX_BASE_URL).toBe("https://runtime.example.com/v1");
    expect(env.OPENAI_BASE_URL).toBeUndefined();
  });
});

describe("codex app-server startup retry", () => {
  function getRetryWarnings(logger: { warn: ReturnType<typeof vi.fn> }) {
    return logger.warn.mock.calls.filter(
      (call) =>
        call[1] === "WARN [runtime:codex] Codex app-server port handoff failed, retrying startup",
    );
  }

  it("retries startup when the first reserved port handoff fails", async () => {
    const reservePort = vi.fn().mockResolvedValueOnce(41001).mockResolvedValueOnce(41002);
    const spawnCodexAppServer = vi
      .fn()
      .mockReturnValueOnce({
        process: { pid: 101 } as never,
        stderr: ["first failure details"],
      })
      .mockReturnValueOnce({
        process: { pid: 102 } as never,
        stderr: [],
      });
    const connectJsonRpcClient = vi
      .fn()
      .mockRejectedValueOnce(new Error("websocket connect failed"))
      .mockResolvedValueOnce({
        request: vi.fn(),
        close: vi.fn(),
      });
    const terminateProcess = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const startup = await startCodexAppServerWithRetry(createModelDiscoveryInput(), logger, {
      reservePort,
      spawnCodexAppServer,
      connectJsonRpcClient,
      terminateProcess,
      sleep,
    });

    expect(startup.attempt).toBe(2);
    expect(startup.listenPort).toBe(41002);
    expect(startup.listenUrl).toBe("ws://127.0.0.1:41002");
    expect(terminateProcess).toHaveBeenCalledTimes(1);
    expect(terminateProcess).toHaveBeenCalledWith(expect.objectContaining({ pid: 101 }));
    expect(getRetryWarnings(logger)).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("logs error and throws after startup retries are exhausted", async () => {
    const reservePort = vi.fn().mockResolvedValue(43000);
    const spawnCodexAppServer = vi.fn().mockReturnValue({
      process: { pid: 777 } as never,
      stderr: ["fatal startup stderr"],
    });
    const connectJsonRpcClient = vi.fn().mockRejectedValue(new Error("connect timeout"));
    const terminateProcess = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await expect(
      startCodexAppServerWithRetry(createModelDiscoveryInput(), logger, {
        reservePort,
        spawnCodexAppServer,
        connectJsonRpcClient,
        terminateProcess,
        sleep,
      }),
    ).rejects.toThrow("fatal startup stderr");

    expect(connectJsonRpcClient).toHaveBeenCalledTimes(3);
    expect(terminateProcess).toHaveBeenCalledTimes(3);
    expect(getRetryWarnings(logger)).toHaveLength(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
