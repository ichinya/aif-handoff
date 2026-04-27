import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { logger } from "@aif/shared";

const log = logger("codex-login-broker");

const DEFAULT_PORT = 3010;
const DEFAULT_HOST = "0.0.0.0";

const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const VERIFICATION_URL = "https://auth.openai.com/codex/device";
const ANSI_PATTERN = /\x1B\[[0-9;]*[A-Za-z]/g;
const USER_CODE_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{4,}\b/;

export interface DeviceAuthInfo {
  verificationUrl: string;
  userCode: string;
}

export interface LoginSession {
  id: string;
  child: ChildProcessWithoutNullStreams;
  verificationUrl: string;
  userCode: string;
  startedAt: number;
  timeoutHandle: NodeJS.Timeout;
}

export interface BrokerRuntime {
  app: Hono;
  /** Internal accessor for tests */
  getCurrentSession(): LoginSession | null;
}

export interface BrokerServer {
  runtime: BrokerRuntime;
  server: ServerType;
  port: number;
  host: string;
  close(): Promise<void>;
}

export interface BrokerOptions {
  port?: number;
  host?: string;
  codexCliPath?: string;
  /** Override spawn for tests */
  spawnFn?: typeof spawn;
}

interface BrokerContext {
  currentSession: LoginSession | null;
  options: Required<Omit<BrokerOptions, "spawnFn">> & {
    spawnFn: typeof spawn;
  };
}

/**
 * Extract verification URL and one-time code from `codex login --device-auth`
 * stdout. The CLI prints a fixed verification URL and a code like
 * `XXXX-YYYYY`. ANSI escape codes are stripped before matching. Both fields
 * must be present for a successful parse — partial output returns null.
 */
export function extractDeviceAuth(buffered: string): DeviceAuthInfo | null {
  const cleaned = buffered.replace(ANSI_PATTERN, "");
  if (!cleaned.includes(VERIFICATION_URL)) return null;
  const codeMatch = USER_CODE_PATTERN.exec(cleaned);
  if (!codeMatch) return null;
  return { verificationUrl: VERIFICATION_URL, userCode: codeMatch[0] };
}

/** Mask all but the last 2 characters of the one-time code for logging. */
export function maskUserCode(code: string): string {
  if (code.length <= 2) return "***";
  return `${"*".repeat(code.length - 2)}${code.slice(-2)}`;
}

function terminateSession(ctx: BrokerContext, reason: string): void {
  const session = ctx.currentSession;
  if (!session) return;
  log.info({ sessionId: session.id, reason }, "[Broker.terminateSession] ending session");
  clearTimeout(session.timeoutHandle);
  if (!session.child.killed) {
    try {
      session.child.kill("SIGTERM");
    } catch (err) {
      log.warn({ err }, "[Broker.terminateSession] failed to kill child");
    }
  }
  ctx.currentSession = null;
}

function createBrokerApp(ctx: BrokerContext): Hono {
  const app = new Hono();

  app.get("/codex/login/status", (c) => {
    log.debug("[Broker.status] enter");
    const session = ctx.currentSession;
    if (!session) return c.json({ active: false });
    return c.json({
      active: true,
      sessionId: session.id,
      verificationUrl: session.verificationUrl,
      userCode: session.userCode,
      startedAt: new Date(session.startedAt).toISOString(),
    });
  });

  app.post("/codex/login/start", async (c) => {
    log.debug("[Broker.start] enter");

    if (ctx.currentSession) {
      log.warn(
        { sessionId: ctx.currentSession.id },
        "[Broker.start] rejected — session already active",
      );
      return c.json(
        {
          error: "session_already_active",
          sessionId: ctx.currentSession.id,
          verificationUrl: ctx.currentSession.verificationUrl,
          userCode: ctx.currentSession.userCode,
        },
        409,
      );
    }

    const cliPath = ctx.options.codexCliPath;
    log.debug({ cliPath }, "[Broker.start] spawning codex login --device-auth");

    let child: ChildProcessWithoutNullStreams;
    try {
      child = ctx.options.spawnFn(cliPath, ["login", "--device-auth"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err) {
      log.error({ err }, "[Broker.start] spawn failed");
      return c.json({ error: "spawn_failed", message: String(err) }, 500);
    }

    const sessionId = randomUUID();
    const startedAt = Date.now();

    const parsePromise = new Promise<DeviceAuthInfo>((resolve, reject) => {
      let settled = false;
      let buffered = "";

      const tryParse = () => {
        const info = extractDeviceAuth(buffered);
        if (info && !settled) {
          settled = true;
          child.stdout.off("data", onData);
          child.stderr.off("data", onStderr);
          resolve(info);
        }
      };
      const onData = (data: Buffer) => {
        const text = data.toString("utf8");
        buffered += text;
        log.debug({ chunk: text.slice(0, 200) }, "[Broker.start] codex stdout");
        tryParse();
      };
      const onStderr = (data: Buffer) => {
        const text = data.toString("utf8");
        log.debug({ chunk: text.slice(0, 200) }, "[Broker.start] codex stderr");
        buffered += text;
        tryParse();
      };
      const onExit = (code: number | null) => {
        if (!settled) {
          settled = true;
          reject(new Error(`codex exited before printing device auth (code=${code})`));
        }
      };
      const onError = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      child.stdout.on("data", onData);
      child.stderr.on("data", onStderr);
      child.once("exit", onExit);
      child.once("error", onError);

      setTimeout(() => {
        if (!settled) {
          settled = true;
          child.stdout.off("data", onData);
          child.stderr.off("data", onStderr);
          reject(new Error("timed out waiting for codex device auth output"));
        }
      }, 15_000).unref();
    });

    let info: DeviceAuthInfo;
    try {
      info = await parsePromise;
    } catch (err) {
      log.error({ err }, "[Broker.start] failed to parse device auth output");
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      return c.json({ error: "device_auth_parse_failed", message: String(err) }, 500);
    }

    log.debug({ userCodeMasked: maskUserCode(info.userCode) }, "[Broker.start] device auth parsed");

    const timeoutHandle = setTimeout(() => {
      log.warn({ sessionId }, "[Broker.start] session timed out");
      terminateSession(ctx, "timeout");
    }, SESSION_TIMEOUT_MS);
    timeoutHandle.unref();

    const session: LoginSession = {
      id: sessionId,
      child,
      verificationUrl: info.verificationUrl,
      userCode: info.userCode,
      startedAt,
      timeoutHandle,
    };

    child.once("exit", (code, signal) => {
      log.info({ sessionId, code, signal }, "[Broker.childExit] codex exited");
      if (ctx.currentSession?.id === sessionId) {
        clearTimeout(session.timeoutHandle);
        ctx.currentSession = null;
      }
    });

    ctx.currentSession = session;
    log.info(
      { sessionId, userCodeMasked: maskUserCode(info.userCode) },
      "[Broker.start] session started",
    );
    return c.json({
      sessionId,
      verificationUrl: info.verificationUrl,
      userCode: info.userCode,
      startedAt: new Date(startedAt).toISOString(),
    });
  });

  app.post("/codex/login/cancel", (c) => {
    log.debug("[Broker.cancel] enter");
    const session = ctx.currentSession;
    if (!session) return c.json({ ok: true, cancelled: false });
    terminateSession(ctx, "cancel");
    return c.json({ ok: true, cancelled: true, sessionId: session.id });
  });

  return app;
}

export function createBrokerRuntime(options: BrokerOptions = {}): BrokerRuntime {
  const ctx: BrokerContext = {
    currentSession: null,
    options: {
      port: options.port ?? DEFAULT_PORT,
      host: options.host ?? DEFAULT_HOST,
      codexCliPath: options.codexCliPath ?? "codex",
      spawnFn: options.spawnFn ?? spawn,
    },
  };

  const app = createBrokerApp(ctx);
  return {
    app,
    getCurrentSession: () => ctx.currentSession,
  };
}

export async function startLoginBroker(options: BrokerOptions = {}): Promise<BrokerServer> {
  const runtime = createBrokerRuntime(options);
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;

  const server = serve({ fetch: runtime.app.fetch, port, hostname: host });
  log.info({ host, port }, "[CodexLoginBroker] listening");

  return {
    runtime,
    server,
    port,
    host,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
