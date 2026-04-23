import {
  RuntimeTransport,
  type RuntimeEvent,
  type RuntimeSession,
  type RuntimeSessionEventsInput,
  type RuntimeSessionGetInput,
  type RuntimeSessionListInput,
} from "../../../types.js";
import { CodexAppServerClient } from "./client.js";
import { JsonlRpcClient } from "./jsonlRpcClient.js";
import { spawnCodexAppServerProcess, terminateCodexAppServerProcess } from "./process.js";
import type { Thread } from "./generated/v2/Thread.js";
import type { ThreadItem } from "./generated/v2/ThreadItem.js";
import type { UserInput } from "./generated/v2/UserInput.js";

export interface CodexAppServerSessionLogger {
  debug?(context: Record<string, unknown>, message: string): void;
  info?(context: Record<string, unknown>, message: string): void;
  warn?(context: Record<string, unknown>, message: string): void;
  error?(context: Record<string, unknown>, message: string): void;
}

const DEFAULT_SESSION_REQUEST_TIMEOUT_MS = 8_000;

export async function listCodexAppServerSessions(
  input: RuntimeSessionListInput,
  logger?: CodexAppServerSessionLogger,
): Promise<RuntimeSession[]> {
  return await withAppServerSessionClient(input, logger, async (client) => {
    const result = await client.listThreads({
      limit: input.limit ?? 50,
      cursor: null,
      cwd: input.projectRoot ?? null,
      archived: false,
      sortKey: "updated_at",
      sourceKinds: null,
      modelProviders: null,
      searchTerm: null,
    });

    return result.data.map((thread) => mapThreadToRuntimeSession(thread, input));
  });
}

export async function getCodexAppServerSession(
  input: RuntimeSessionGetInput,
  logger?: CodexAppServerSessionLogger,
): Promise<RuntimeSession | null> {
  return await withAppServerSessionClient(input, logger, async (client) => {
    const result = await client.readThread({
      threadId: input.sessionId,
      includeTurns: false,
    });
    return mapThreadToRuntimeSession(result.thread, input);
  });
}

export async function listCodexAppServerSessionEvents(
  input: RuntimeSessionEventsInput,
  logger?: CodexAppServerSessionLogger,
): Promise<RuntimeEvent[]> {
  return await withAppServerSessionClient(input, logger, async (client) => {
    const result = await client.readThread({
      threadId: input.sessionId,
      includeTurns: true,
    });
    const events = threadToRuntimeEvents(result.thread);
    return input.limit ? events.slice(-input.limit) : events;
  });
}

async function withAppServerSessionClient<T>(
  input: RuntimeSessionListInput | RuntimeSessionGetInput,
  logger: CodexAppServerSessionLogger | undefined,
  run: (client: CodexAppServerClient) => Promise<T>,
): Promise<T> {
  const launch = spawnCodexAppServerProcess({
    input: {
      runtimeId: input.runtimeId,
      profileId: input.profileId ?? null,
      transport: RuntimeTransport.APP_SERVER,
      projectRoot: input.projectRoot,
      options: input.options ?? {},
    },
    logger,
  });
  const rpcClient = new JsonlRpcClient(launch.process, {
    runtimeId: input.runtimeId,
    profileId: input.profileId ?? null,
    transport: RuntimeTransport.APP_SERVER,
    requestTimeoutMs: DEFAULT_SESSION_REQUEST_TIMEOUT_MS,
    logger,
  });
  const client = new CodexAppServerClient(rpcClient, {
    runtimeId: input.runtimeId,
    profileId: input.profileId ?? null,
    transport: RuntimeTransport.APP_SERVER,
    requestTimeoutMs: DEFAULT_SESSION_REQUEST_TIMEOUT_MS,
    logger,
  });

  try {
    await client.initialize({
      clientInfo: {
        name: "aif-runtime-codex-session-discovery",
        title: "AIF Runtime Codex Session Discovery",
        version: "1.0",
      },
      capabilities: {
        experimentalApi: false,
      },
    });
    return await run(client);
  } finally {
    client.close("session discovery finished");
    await terminateCodexAppServerProcess(launch, logger);
  }
}

function mapThreadToRuntimeSession(
  thread: Thread,
  input: RuntimeSessionListInput | RuntimeSessionGetInput,
): RuntimeSession {
  return {
    id: thread.id,
    runtimeId: input.runtimeId,
    providerId: input.providerId ?? thread.modelProvider ?? "openai",
    profileId: input.profileId ?? null,
    title: thread.name ?? truncateTitle(thread.preview) ?? null,
    createdAt: toIsoFromSeconds(thread.createdAt),
    updatedAt: toIsoFromSeconds(thread.updatedAt),
    metadata: {
      cwd: thread.cwd,
      source: thread.source,
      status: thread.status,
      raw: thread,
    },
  };
}

function threadToRuntimeEvents(thread: Thread): RuntimeEvent[] {
  const timestamp = toIsoFromSeconds(thread.updatedAt);
  const events: RuntimeEvent[] = [];

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      const event = threadItemToRuntimeEvent(item, timestamp);
      if (event) {
        events.push(event);
      }
    }
  }

  return events;
}

function threadItemToRuntimeEvent(item: ThreadItem, timestamp: string): RuntimeEvent | null {
  if (item.type === "userMessage") {
    const message = renderUserInput(item.content);
    if (!message) {
      return null;
    }
    return {
      type: "session-message",
      timestamp,
      level: "info",
      message,
      data: {
        role: "user",
        id: item.id,
      },
    };
  }

  if (item.type === "agentMessage") {
    if (item.phase && item.phase !== "final_answer") {
      return null;
    }
    if (!item.text.trim()) {
      return null;
    }
    return {
      type: "session-message",
      timestamp,
      level: "info",
      message: item.text,
      data: {
        role: "assistant",
        id: item.id,
      },
    };
  }

  return null;
}

function renderUserInput(content: UserInput[]): string {
  return content
    .map((entry) => {
      switch (entry.type) {
        case "text":
          return entry.text;
        case "image":
          return `[image: ${entry.url}]`;
        case "localImage":
          return `[image: ${entry.path}]`;
        case "skill":
          return `[$${entry.name}](${entry.path})`;
        case "mention":
          return `[@${entry.name}](${entry.path})`;
        default:
          return "";
      }
    })
    .filter((part) => part.trim().length > 0)
    .join("\n\n")
    .trim();
}

function toIsoFromSeconds(value: number): string {
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function truncateTitle(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
}
