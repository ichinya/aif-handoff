import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { getDb, logger } from "@aif/shared";
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
app.use("*", cors());
app.use("*", requestLogger);

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

// Routes
app.route("/projects", projectsRouter);
app.route("/tasks", tasksRouter);

// Initialize DB and start server
const port = Number(process.env.PORT) || 3001;

// Ensure DB is ready (creates file if needed)
getDb();

const server = serve({ fetch: app.fetch, port }, () => {
  log.info({ port }, "API server started");
});

// Inject WebSocket into the running server
injectWebSocket(server);
log.debug("WebSocket injected into server");

export { app };
