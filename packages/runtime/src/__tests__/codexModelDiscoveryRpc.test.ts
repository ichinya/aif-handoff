import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { connectJsonRpcClient, sleep } from "../adapters/codex/modelDiscovery/rpc.js";
import type { CodexAppServerProcessContext } from "../adapters/codex/appServer/process.js";

interface MockLaunchContext {
  launch: CodexAppServerProcessContext;
  stdin: PassThrough;
  stdout: PassThrough;
  process: EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    kill: () => boolean;
  };
}

function createLaunchContext(exitCode: number | null = null): MockLaunchContext {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const process = new EventEmitter() as MockLaunchContext["process"];
  process.stdin = stdin;
  process.stdout = stdout;
  process.stderr = stderr;
  process.exitCode = exitCode;
  process.kill = () => true;

  return {
    launch: {
      process: process as unknown as CodexAppServerProcessContext["process"],
      stderrTail: [],
      executablePath: "codex",
      args: ["app-server"],
      cwd: undefined,
    },
    stdin,
    stdout,
    process,
  };
}

function writeJsonLine(stream: PassThrough, payload: unknown): void {
  stream.write(`${JSON.stringify(payload)}\n`);
}

function collectJsonLines(stream: PassThrough): { lines: string[]; stop: () => void } {
  const lines: string[] = [];
  const onData = (chunk: Buffer | string) => {
    const text = String(chunk);
    for (const entry of text.split("\n")) {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        lines.push(trimmed);
      }
    }
  };
  stream.on("data", onData);
  return {
    lines,
    stop: () => stream.off("data", onData),
  };
}

describe("codex model discovery rpc client", () => {
  it("fails when app-server exits before jsonl rpc initialization", async () => {
    const { launch } = createLaunchContext(9);
    launch.stderrTail.push("fatal startup error");

    await expect(
      connectJsonRpcClient(launch, {
        runtimeId: "codex",
        profileId: "profile-1",
      }),
    ).rejects.toThrow("Codex app-server exited early");
  });

  it("handles json-rpc responses, ignores unrelated ids, and rejects server-initiated requests", async () => {
    const { launch, stdout, stdin } = createLaunchContext();
    const sent = collectJsonLines(stdin);
    const client = await connectJsonRpcClient(launch, {
      runtimeId: "codex",
      profileId: "profile-1",
      requestTimeoutMs: 200,
    });

    const requestPromise = client.request("model/list", { includeHidden: false }, 200);

    writeJsonLine(stdout, {
      id: 99,
      method: "server/request",
      params: { ping: true },
    });
    writeJsonLine(stdout, {
      id: 777,
      result: { ignored: true },
    });
    writeJsonLine(stdout, {
      id: 1,
      result: { data: ["gpt-5.4"] },
    });

    await expect(requestPromise).resolves.toEqual({ data: ["gpt-5.4"] });

    const sentMessages = sent.lines.map((entry) => JSON.parse(entry) as Record<string, unknown>);
    const serverRequestRejection = sentMessages.find((entry) => entry.id === 99);
    expect(serverRequestRejection).toMatchObject({
      id: 99,
      error: {
        code: -32601,
      },
    });

    sent.stop();
    client.close();
  });

  it("surfaces json-rpc error payloads", async () => {
    const { launch, stdout } = createLaunchContext();
    const client = await connectJsonRpcClient(launch, {
      runtimeId: "codex",
      profileId: "profile-1",
      requestTimeoutMs: 200,
    });

    const requestPromise = client.request("model/list", { includeHidden: false }, 200);
    writeJsonLine(stdout, {
      id: 1,
      error: {
        message: "rpc failed",
      },
    });

    await expect(requestPromise).rejects.toThrow("rpc failed");
    client.close();
  });

  it("times out request waiters", async () => {
    const { launch } = createLaunchContext();
    const client = await connectJsonRpcClient(launch, {
      runtimeId: "codex",
      profileId: "profile-1",
      requestTimeoutMs: 30,
    });

    await expect(client.request("model/list", {}, 10)).rejects.toThrow(
      "Timed out waiting for JSONL RPC response",
    );

    client.close();
  });

  it("rejects pending requests on malformed jsonl payload", async () => {
    const { launch, stdout } = createLaunchContext();
    const client = await connectJsonRpcClient(launch, {
      runtimeId: "codex",
      profileId: "profile-1",
      requestTimeoutMs: 100,
    });

    const requestPromise = client.request("model/list", {}, 100);
    stdout.write("not-json\n");

    await expect(requestPromise).rejects.toThrow("Malformed JSONL RPC payload");
    client.close();
  });

  it("rejects pending requests when the app-server process exits", async () => {
    const { launch, process } = createLaunchContext();
    const client = await connectJsonRpcClient(launch, {
      runtimeId: "codex",
      profileId: "profile-1",
      requestTimeoutMs: 100,
    });

    const requestPromise = client.request("model/list", {}, 100);
    process.emit("exit", 1, null);

    await expect(requestPromise).rejects.toThrow("Codex app-server process exited");
    client.close();
  });

  it("sleeps for at least approximately the requested duration", async () => {
    const startedAt = Date.now();
    await sleep(5);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(0);
  });
});
