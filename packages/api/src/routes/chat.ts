import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger, env } from "@aif/shared";
import { findProjectById } from "../repositories/projects.js";
import { chatRequestSchema } from "../schemas.js";
import { sendToClient } from "../ws.js";
import type { WsEvent } from "@aif/shared";

const PROJECT_SCOPE_SYSTEM_APPEND =
  "Project scope rule: work strictly inside the current working directory (project root). " +
  "Do not inspect or modify files in the orchestrator monorepo or in parent/sibling directories " +
  "unless the user explicitly asks for that path. Avoid broad discovery outside the current project root.";

const log = logger("chat-route");

// Track active conversations for multi-turn resume
const conversationSessions = new Map<string, string>();

function extractErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Claude Code returned an error result:\s*/i, "").trim();
}

function classifyChatError(err: unknown): {
  status: 429 | 500;
  code: string;
  message: string;
} {
  const message = extractErrorMessage(err);
  const lowered = message.toLowerCase();

  if (
    lowered.includes("out of extra usage") ||
    lowered.includes("usage limit") ||
    lowered.includes("rate limit")
  ) {
    return {
      status: 429,
      code: "CHAT_USAGE_LIMIT",
      message,
    };
  }

  return {
    status: 500,
    code: "CHAT_REQUEST_FAILED",
    message: "Chat request failed",
  };
}

export const chatRouter = new Hono();

// POST /chat
chatRouter.post("/", zValidator("json", chatRequestSchema as any), async (c) => {
  const body = c.req.valid("json");
  const { projectId, message, clientId, conversationId, explore } = body;

  const project = findProjectById(projectId);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const chatConversationId = conversationId ?? crypto.randomUUID();
  log.info(
    { projectId, clientId, conversationId: chatConversationId, explore },
    "Chat request started",
  );

  try {
    const resumeSessionId = conversationId ? conversationSessions.get(conversationId) : undefined;

    const prompt = explore ? `/aif-explore ${message}` : message;

    const stream = query({
      prompt,
      options: {
        cwd: project.rootPath,
        permissionMode: env.AGENT_BYPASS_PERMISSIONS ? "bypassPermissions" : "acceptEdits",
        ...(env.AGENT_BYPASS_PERMISSIONS ? { allowDangerouslySkipPermissions: true } : {}),
        settingSources: [],
        includePartialMessages: true,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: PROJECT_SCOPE_SYSTEM_APPEND,
        },
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        allowedTools: ["Read", "Glob", "Grep", "Bash", "Edit", "Write"],
        maxTurns: 20,
      },
    });

    let sessionId: string | undefined;

    for await (const msg of stream) {
      if (!msg || typeof msg !== "object" || !("type" in msg)) continue;
      const typed = msg as { type: string; [key: string]: unknown };

      // Capture session_id from init message for multi-turn resume
      if (
        typed.type === "system" &&
        typed.subtype === "init" &&
        typeof typed.session_id === "string"
      ) {
        sessionId = typed.session_id;
        conversationSessions.set(chatConversationId, sessionId);
        log.debug({ sessionId, conversationId: chatConversationId }, "Chat session initialized");
      }

      // Stream text tokens to client via WS
      if (typed.type === "stream_event") {
        const event = (
          typed as { event?: { type?: string; delta?: { type?: string; text?: string } } }
        ).event;
        if (
          event?.type === "content_block_delta" &&
          event.delta?.type === "text_delta" &&
          event.delta.text
        ) {
          const tokenEvent: WsEvent = {
            type: "chat:token",
            payload: { conversationId: chatConversationId, token: event.delta.text },
          };
          sendToClient(clientId, tokenEvent);
          log.debug(
            { conversationId: chatConversationId, tokenLength: event.delta.text.length },
            "Streamed chat token",
          );
        }
      }

      // Handle result message
      if (typed.type === "result") {
        if (typed.subtype === "success") {
          log.info({ conversationId: chatConversationId }, "Chat request completed successfully");
        } else {
          log.error(
            { conversationId: chatConversationId, subtype: typed.subtype },
            "Chat query ended with non-success",
          );
        }
      }
    }

    // Signal completion
    const doneEvent: WsEvent = {
      type: "chat:done",
      payload: { conversationId: chatConversationId },
    };
    sendToClient(clientId, doneEvent);

    log.info({ conversationId: chatConversationId }, "Chat request ended");

    return c.json({ conversationId: chatConversationId });
  } catch (err) {
    log.error({ err, conversationId: chatConversationId }, "Chat request failed");
    const classified = classifyChatError(err);

    const errorEvent: WsEvent = {
      type: "chat:error",
      payload: {
        conversationId: chatConversationId,
        message: classified.message,
        code: classified.code,
      },
    };
    sendToClient(clientId, errorEvent);

    const doneEvent: WsEvent = {
      type: "chat:done",
      payload: { conversationId: chatConversationId },
    };
    sendToClient(clientId, doneEvent);

    return c.json({ error: classified.message, code: classified.code }, classified.status);
  }
});
