import type { AppServerLaunchContext, JsonRpcClient } from "./types.js";

interface JsonRpcMessage {
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

class JsonRpcWebSocketClient implements JsonRpcClient {
  private readonly socket: WebSocket;
  private readonly queue: JsonRpcMessage[] = [];
  private readonly waiters: Array<(message: JsonRpcMessage) => void> = [];
  private nextId = 0;
  private closed = false;
  private closeError: Error | null = null;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });
    socket.addEventListener("error", () => {
      this.handleClose(new Error("Codex app-server websocket errored"));
    });
    socket.addEventListener("close", () => {
      this.handleClose(new Error("Codex app-server websocket closed"));
    });
  }

  async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const id = ++this.nextId;
    this.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    );

    while (true) {
      const message = await this.nextMessage(timeoutMs);

      if (typeof message.method === "string" && message.id != null) {
        this.socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32601,
              message: "Unsupported server-initiated request during Codex model discovery",
            },
          }),
        );
        continue;
      }

      if (message.id !== id) {
        continue;
      }

      if (message.error) {
        throw new Error(message.error.message ?? `Codex app-server request failed (${method})`);
      }

      return message.result;
    }
  }

  async close(): Promise<void> {
    if (
      this.socket.readyState === WebSocket.CLOSED ||
      this.socket.readyState === WebSocket.CLOSING
    ) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 200);
      this.socket.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      this.socket.close();
    });
  }

  private async handleMessage(data: unknown): Promise<void> {
    const text = await toMessageText(data);
    if (!text) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        this.enqueueMessage(entry);
      }
      return;
    }

    this.enqueueMessage(parsed);
  }

  private enqueueMessage(candidate: unknown): void {
    if (!candidate || typeof candidate !== "object") {
      return;
    }

    const message = candidate as JsonRpcMessage;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(message);
      return;
    }

    this.queue.push(message);
  }

  private nextMessage(timeoutMs: number): Promise<JsonRpcMessage> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }

    if (this.closed) {
      return Promise.reject(this.closeError ?? new Error("Codex app-server websocket closed"));
    }

    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const waiter = (message: JsonRpcMessage) => {
        clearTimeout(timer);
        resolve(message);
      };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error("Timed out waiting for Codex app-server response"));
      }, timeoutMs);

      this.waiters.push(waiter);
    });
  }

  private handleClose(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeError = error;

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({
        error: {
          message: error.message,
        },
      });
    }
  }
}

export async function connectJsonRpcClient(
  listenUrl: string,
  launch: AppServerLaunchContext,
  timeoutMs: number,
): Promise<JsonRpcClient> {
  const WebSocketCtor = globalThis.WebSocket;
  if (typeof WebSocketCtor !== "function") {
    throw new Error("Global WebSocket is not available in this Node runtime");
  }

  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    if (launch.process.exitCode != null) {
      const details = launch.stderr.join("").trim();
      throw new Error(
        details
          ? `Codex app-server exited early with code ${launch.process.exitCode}: ${details}`
          : `Codex app-server exited early with code ${launch.process.exitCode}`,
      );
    }

    try {
      const socket = await openWebSocket(WebSocketCtor, listenUrl, 1_000);
      return new JsonRpcWebSocketClient(socket);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(100);
    }
  }

  throw new Error(
    lastError
      ? `Timed out connecting to Codex app-server: ${lastError}`
      : "Timed out connecting to Codex app-server",
  );
}

export async function sleep(ms: number): Promise<void> {
  return await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function openWebSocket(
  WebSocketCtor: typeof WebSocket,
  listenUrl: string,
  timeoutMs: number,
): Promise<WebSocket> {
  return await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocketCtor(listenUrl);
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
    };

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const handleOpen = () => {
      settle(() => resolve(socket));
    };

    const handleError = () => {
      settle(() => reject(new Error("Codex app-server websocket connection failed")));
    };

    const handleClose = () => {
      settle(() => reject(new Error("Codex app-server websocket closed before initialization")));
    };

    const timer = setTimeout(() => {
      settle(() => {
        try {
          socket.close();
        } catch {
          // ignored
        }
        reject(new Error("Timed out opening Codex app-server websocket"));
      });
    }, timeoutMs);

    socket.addEventListener("open", handleOpen, { once: true });
    socket.addEventListener("error", handleError, { once: true });
    socket.addEventListener("close", handleClose, { once: true });
  });
}

async function toMessageText(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.text();
  }
  return "";
}
