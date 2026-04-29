import { once } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlRpcClient, JsonlRpcResponseError } from "../jsonlRpcClient.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url),
);
const TEST_REQUEST_TIMEOUT_MS = 2_500;

const runningChildren = new Set<ChildProcessWithoutNullStreams>();

function spawnFakeServer(scenario: string): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [FIXTURE_PATH], {
    stdio: "pipe",
    env: {
      ...process.env,
      FAKE_CODEX_SCENARIO: scenario,
    },
  });
  runningChildren.add(child);
  return child;
}

async function shutdownChildProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  runningChildren.delete(child);
  if (child.exitCode != null) {
    return;
  }
  child.kill();
  await once(child, "exit").catch(() => undefined);
}

afterEach(async () => {
  await Promise.all([...runningChildren].map((child) => shutdownChildProcess(child)));
});

describe("codex app-server jsonl rpc client", () => {
  it("handles notifications and successful responses", async () => {
    const child = spawnFakeServer("notification-before-success");
    const notifications: string[] = [];
    const client = new JsonlRpcClient(child, {
      runtimeId: "codex",
      profileId: "profile-1",
      requestTimeoutMs: TEST_REQUEST_TIMEOUT_MS,
      onNotification: (notification) => {
        notifications.push(notification.method);
      },
    });

    await expect(
      client.request("echo", { hello: "world" }, TEST_REQUEST_TIMEOUT_MS),
    ).resolves.toEqual({ ok: true });
    expect(notifications).toContain("item/agentMessage/delta");

    client.close();
    await shutdownChildProcess(child);
  });

  it("surfaces structured rpc failures via JsonlRpcResponseError", async () => {
    const child = spawnFakeServer("rpc-error");
    const client = new JsonlRpcClient(child, {
      runtimeId: "codex",
      profileId: "profile-1",
      requestTimeoutMs: TEST_REQUEST_TIMEOUT_MS,
    });

    await expect(client.request("echo", {}, TEST_REQUEST_TIMEOUT_MS)).rejects.toMatchObject({
      name: "JsonlRpcResponseError",
      message: "rpc failed",
      rpcMethod: "echo",
      rpcCode: -32000,
      rpcData: { category: "transport" },
    } as Partial<JsonlRpcResponseError>);

    client.close();
    await shutdownChildProcess(child);
  });

  it("does not parse stderr as protocol payload", async () => {
    const child = spawnFakeServer("stderr-noise");
    const client = new JsonlRpcClient(child, {
      runtimeId: "codex",
      profileId: "profile-1",
      requestTimeoutMs: TEST_REQUEST_TIMEOUT_MS,
    });

    await expect(client.request("echo", { ping: true }, TEST_REQUEST_TIMEOUT_MS)).resolves.toEqual({
      echo: { ping: true },
    });

    client.close();
    await shutdownChildProcess(child);
  });

  it("rejects pending requests on malformed JSON output", async () => {
    const child = spawnFakeServer("malformed-after-request");
    const client = new JsonlRpcClient(child, {
      runtimeId: "codex",
      profileId: "profile-1",
      requestTimeoutMs: TEST_REQUEST_TIMEOUT_MS,
    });

    await expect(client.request("echo", {}, TEST_REQUEST_TIMEOUT_MS)).rejects.toThrow(
      "Malformed JSONL RPC payload from Codex app-server",
    );

    client.close();
    await shutdownChildProcess(child);
  });

  it("rejects pending requests when the child process exits before responding", async () => {
    const child = spawnFakeServer("exit-before-response");
    const client = new JsonlRpcClient(child, {
      runtimeId: "codex",
      profileId: "profile-1",
      requestTimeoutMs: TEST_REQUEST_TIMEOUT_MS,
    });

    await expect(client.request("echo", {}, TEST_REQUEST_TIMEOUT_MS)).rejects.toThrow(
      "Codex app-server process exited while RPC requests were pending",
    );

    client.close();
    await shutdownChildProcess(child);
  });
});
