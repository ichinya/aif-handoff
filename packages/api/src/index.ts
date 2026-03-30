import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { logger, getEnv } from "@aif/shared";
import { listProjects } from "@aif/data";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { projectsRouter } from "./routes/projects.js";
import { tasksRouter } from "./routes/tasks.js";
import { setupWebSocket } from "./ws.js";
import { requestLogger } from "./middleware/logger.js";

const log = logger("server");
const startTime = Date.now();

const app = new Hono();

// WebSocket must be set up before routes
const { injectWebSocket } = setupWebSocket(app);

// Middleware
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  }),
);
app.use("*", requestLogger);

function detectClaudeAuthProfile(): { hasClaudeAuth: boolean; detectedPath: string | null } {
  const home = homedir();
  const candidateFiles = [
    join(home, ".claude.json"),
    join(home, ".claude", "auth.json"),
    join(home, ".claude", "credentials.json"),
    join(home, ".config", "claude", "auth.json"),
    join(home, ".config", "claude", "credentials.json"),
  ];

  for (const filePath of candidateFiles) {
    if (existsSync(filePath)) {
      return { hasClaudeAuth: true, detectedPath: filePath };
    }
  }

  const candidateDirs = [join(home, ".claude"), join(home, ".config", "claude")];

  for (const dirPath of candidateDirs) {
    if (!existsSync(dirPath)) continue;
    try {
      const hasAnyJson = readdirSync(dirPath, { withFileTypes: true }).some(
        (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"),
      );
      if (hasAnyJson) {
        return { hasClaudeAuth: true, detectedPath: dirPath };
      }
    } catch {
      // Ignore unreadable directories; readiness stays false unless another source is found.
    }
  }

  return { hasClaudeAuth: false, detectedPath: null };
}

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

app.get("/agent/readiness", (c) => {
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const { hasClaudeAuth, detectedPath } = detectClaudeAuthProfile();
  const ready = hasApiKey || hasClaudeAuth;
  const authSource = hasApiKey
    ? hasClaudeAuth
      ? "both"
      : "api_key"
    : hasClaudeAuth
      ? "claude_profile"
      : "none";

  return c.json({
    ready,
    hasApiKey,
    hasClaudeAuth,
    authSource,
    detectedPath,
    message: ready
      ? "Agent authentication is configured."
      : "Claude authentication not found. Set ANTHROPIC_API_KEY in .env or sign in via Claude Code profile (~/.claude).",
    checkedAt: new Date().toISOString(),
  });
});

// Settings (expose env defaults to frontend)
app.get("/settings", (c) => {
  const env = getEnv();
  return c.json({ useSubagents: env.AGENT_USE_SUBAGENTS });
});

// Routes
app.route("/projects", projectsRouter);
app.route("/tasks", tasksRouter);

// Initialize DB and start server
const port = Number(process.env.PORT) || 3001;

// Ensure data layer / DB is ready
listProjects();

const server = serve({ fetch: app.fetch, port }, () => {
  log.info({ port }, "API server started");
});

// Inject WebSocket into the running server
injectWebSocket(server);
log.debug("WebSocket injected into server");

export { app };
