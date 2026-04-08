import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectJsonRpcClient, sleep } from "../adapters/codex/modelDiscovery/rpc.js";
import type { AppServerLaunchContext } from "../adapters/codex/modelDiscovery/types.js";

type EventListener = (event: { data?: unknown }) => void;

type SocketMode = "open" | "error" | "close" | "manual";

let socketMode: SocketMode = "open";
const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly sent: string[] = [];
  readyState = MockWebSocket.CONNECTING;
  private readonly listeners = new Map<string, Array<{ callback: EventListener; once: boolean }>>();

  constructor(_url: string) {
    sockets.push(this);
    if (socketMode === "open") {
      queueMicrotask(() => {
        this.readyState = MockWebSocket.OPEN;
        this.emit("open", {});
      });
    } else if (socketMode === "error") {
      queueMicrotask(() => {
        this.emit("error", {});
      });
    } else if (socketMode === "close") {
      queueMicrotask(() => {
        this.readyState = MockWebSocket.CLOSED;
        this.emit("close", {});
      });
    }
  }

  addEventListener(type: string, callback: EventListener, options?: { once?: boolean }) {
    const entries = this.listeners.get(type) ?? [];
    entries.push({ callback, once: options?.once === true });
    this.listeners.set(type, entries);
  }

  removeEventListener(type: string, callback: EventListener) {
    const entries = this.listeners.get(type);
    if (!entries) {
      return;
    }
    this.listeners.set(
      type,
      entries.filter((entry) => entry.callback !== callback),
    );
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED || this.readyState === MockWebSocket.CLOSING) {
      return;
    }

    this.readyState = MockWebSocket.CLOSING;
    queueMicrotask(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.emit("close", {});
    });
  }

  emit(type: string, event: { data?: unknown }) {
    const entries = [...(this.listeners.get(type) ?? [])];
    for (const entry of entries) {
      entry.callback(event);
      if (entry.once) {
        this.removeEventListener(type, entry.callback);
      }
    }
  }
}

function createLaunchContext(exitCode: number | null = null): AppServerLaunchContext {
  return {
    process: {
      exitCode,
    } as AppServerLaunchContext["process"],
    stderr: [],
  };
}

describe("codex model discovery rpc client", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    socketMode = "open";
    sockets.length = 0;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("fails fast when global websocket is unavailable", async () => {
    const hadWebSocket = "WebSocket" in globalThis;
    const previous = globalThis.WebSocket;
    Reflect.deleteProperty(globalThis, "WebSocket");

    await expect(
      connectJsonRpcClient("ws://127.0.0.1:9001", createLaunchContext(), 100),
    ).rejects.toThrow("Global WebSocket is not available in this Node runtime");

    if (hadWebSocket) {
      globalThis.WebSocket = previous;
    }
  });

  it("fails when app-server exits before websocket initialization", async () => {
    const launch = createLaunchContext(9);
    launch.stderr.push("fatal startup error");

    await expect(connectJsonRpcClient("ws://127.0.0.1:9001", launch, 100)).rejects.toThrow(
      "Codex app-server exited early",
    );
  });

  it("handles json-rpc responses, ignores unrelated ids, and rejects server-initiated requests", async () => {
    const client = await connectJsonRpcClient("ws://127.0.0.1:9001", createLaunchContext(), 300);
    const socket = sockets.at(-1);
    expect(socket).toBeDefined();

    const requestPromise = client.request("model/list", { includeHidden: false }, 200);

    socket!.emit("message", {
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "server/request",
        params: { ping: true },
      }),
    });
    socket!.emit("message", {
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: 777,
        result: { ignored: true },
      }),
    });
    socket!.emit("message", {
      data: JSON.stringify([
        {
          jsonrpc: "2.0",
          id: 1,
          result: { data: ["gpt-5.4"] },
        },
      ]),
    });

    await expect(requestPromise).resolves.toEqual({ data: ["gpt-5.4"] });

    const sentMessages = socket!.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>);
    const serverRequestRejection = sentMessages.find((entry) => entry.id === 99);
    expect(serverRequestRejection).toMatchObject({
      jsonrpc: "2.0",
      id: 99,
      error: {
        code: -32601,
      },
    });

    await client.close();
  });

  it("surfaces json-rpc error payloads", async () => {
    const client = await connectJsonRpcClient("ws://127.0.0.1:9002", createLaunchContext(), 300);
    const socket = sockets.at(-1);
    expect(socket).toBeDefined();

    const requestPromise = client.request("model/list", { includeHidden: false }, 200);
    socket!.emit("message", {
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: {
          message: "rpc failed",
        },
      }),
    });

    await expect(requestPromise).rejects.toThrow("rpc failed");
    await client.close();
  });

  it("times out request waiters and reports repeated connection failures", async () => {
    const client = await connectJsonRpcClient("ws://127.0.0.1:9003", createLaunchContext(), 300);
    await expect(client.request("model/list", {}, 10)).rejects.toThrow(
      "Timed out waiting for Codex app-server response",
    );
    await client.close();

    socketMode = "error";
    await expect(
      connectJsonRpcClient("ws://127.0.0.1:9004", createLaunchContext(), 150),
    ).rejects.toThrow("Timed out connecting to Codex app-server");
  });

  it("sleeps for at least approximately the requested duration", async () => {
    const startedAt = Date.now();
    await sleep(5);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(0);
  });
});
