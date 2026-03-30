import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mockQuery = vi.fn();
const mockFindProjectById = vi.fn();
const mockSendToClient = vi.fn();
const mockFindTaskById = vi.fn();
const mockToTaskResponse = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: unknown) => mockQuery(args),
}));

vi.mock("../repositories/projects.js", () => ({
  findProjectById: (id: string) => mockFindProjectById(id),
}));

vi.mock("../repositories/tasks.js", () => ({
  findTaskById: (id: string) => mockFindTaskById(id),
  toTaskResponse: (row: unknown) => mockToTaskResponse(row),
}));

vi.mock("../ws.js", () => ({
  sendToClient: (...args: unknown[]) => mockSendToClient(...args),
}));

vi.mock("@aif/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared")>();
  return {
    ...actual,
    getEnv: () => ({
      AGENT_BYPASS_PERMISSIONS: false,
    }),
  };
});

const { chatRouter } = await import("../routes/chat.js");

function createApp() {
  const app = new Hono();
  app.route("/chat", chatRouter);
  return app;
}

function streamOf(messages: Array<Record<string, unknown>>) {
  return async function* () {
    for (const msg of messages) {
      yield msg;
    }
  };
}

describe("chat API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    mockQuery.mockReset();
    mockFindProjectById.mockReset();
    mockSendToClient.mockReset();
    mockFindTaskById.mockReset();
    mockToTaskResponse.mockReset();
    mockFindProjectById.mockReturnValue({
      id: "project-1",
      rootPath: "/tmp/project-1",
      name: "Test Project",
    });
  });

  it("returns 404 when project is not found", async () => {
    mockFindProjectById.mockReturnValueOnce(undefined);

    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "missing",
        message: "hello",
        clientId: "client-1",
      }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Project not found" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("streams token and done events for successful response", async () => {
    mockQuery.mockImplementation(
      streamOf([
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Hello " },
          },
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "world" },
          },
        },
        { type: "result", subtype: "success" },
      ]),
    );

    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        message: "plain prompt",
        clientId: "client-1",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.conversationId).toBe("string");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const queryArgs = mockQuery.mock.calls[0][0] as { prompt: string };
    expect(queryArgs.prompt).toBe("plain prompt");

    expect(mockSendToClient).toHaveBeenNthCalledWith(
      1,
      "client-1",
      expect.objectContaining({
        type: "chat:token",
        payload: expect.objectContaining({ token: "Hello " }),
      }),
    );
    expect(mockSendToClient).toHaveBeenNthCalledWith(
      2,
      "client-1",
      expect.objectContaining({
        type: "chat:token",
        payload: expect.objectContaining({ token: "world" }),
      }),
    );
    expect(mockSendToClient).toHaveBeenNthCalledWith(
      3,
      "client-1",
      expect.objectContaining({
        type: "chat:done",
      }),
    );
  });

  it("prefixes prompt with /aif-explore when explore is enabled", async () => {
    mockQuery.mockImplementation(streamOf([{ type: "result", subtype: "success" }]));

    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        message: "investigate this",
        clientId: "client-1",
        explore: true,
      }),
    });

    expect(res.status).toBe(200);
    const queryArgs = mockQuery.mock.calls[0][0] as { prompt: string };
    expect(queryArgs.prompt).toBe("/aif-explore investigate this");
  });

  it("stores session from init message and uses resume for same conversation", async () => {
    mockQuery
      .mockImplementationOnce(
        streamOf([
          { type: "system", subtype: "init", session_id: "session-123" },
          { type: "result", subtype: "success" },
        ]),
      )
      .mockImplementationOnce(streamOf([{ type: "result", subtype: "success" }]));

    const conversationId = "conv-resume-1";

    const firstRes = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        message: "first",
        clientId: "client-1",
        conversationId,
      }),
    });
    expect(firstRes.status).toBe(200);

    const secondRes = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        message: "second",
        clientId: "client-1",
        conversationId,
      }),
    });
    expect(secondRes.status).toBe(200);

    const secondCall = mockQuery.mock.calls[1][0] as {
      options: { resume?: string };
    };
    expect(secondCall.options.resume).toBe("session-123");
  });

  it("returns 200 even when stream result subtype is non-success", async () => {
    mockQuery.mockImplementation(streamOf([{ type: "result", subtype: "error_max_turns" }]));

    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        message: "hello",
        clientId: "client-1",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.conversationId).toBe("string");
    expect(mockSendToClient).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({ type: "chat:done" }),
    );
  });

  it("returns 429 and emits chat:error for usage limit errors", async () => {
    mockQuery.mockImplementation(() => {
      throw new Error(
        "Claude Code returned an error result: You're out of extra usage · resets 7pm",
      );
    });

    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        message: "hello",
        clientId: "client-1",
        conversationId: "conv-limit-1",
      }),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("CHAT_USAGE_LIMIT");
    expect(body.error).toContain("out of extra usage");

    expect(mockSendToClient).toHaveBeenNthCalledWith(
      1,
      "client-1",
      expect.objectContaining({
        type: "chat:error",
        payload: expect.objectContaining({
          conversationId: "conv-limit-1",
          code: "CHAT_USAGE_LIMIT",
        }),
      }),
    );
    expect(mockSendToClient).toHaveBeenNthCalledWith(
      2,
      "client-1",
      expect.objectContaining({ type: "chat:done" }),
    );
  });

  it("returns 500 and generic message for non-limit errors", async () => {
    mockQuery.mockImplementation(() => {
      throw new Error("unexpected failure");
    });

    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        message: "hello",
        clientId: "client-1",
        conversationId: "conv-error-1",
      }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Chat request failed",
      code: "CHAT_REQUEST_FAILED",
    });

    expect(mockSendToClient).toHaveBeenNthCalledWith(
      1,
      "client-1",
      expect.objectContaining({
        type: "chat:error",
        payload: expect.objectContaining({
          conversationId: "conv-error-1",
          code: "CHAT_REQUEST_FAILED",
          message: "Chat request failed",
        }),
      }),
    );
  });
});
