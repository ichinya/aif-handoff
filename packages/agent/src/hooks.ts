import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";
import { getDb, tasks, logger } from "@aif/shared";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

const log = logger("agent-hooks");

/** Find the monorepo root (directory with package.json that has "workspaces"). */
function findMonorepoRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  let dir = dirname(thisFile);

  for (let i = 0; i < 10; i++) {
    const pkgPath = resolve(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return dir;
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return resolve(dirname(thisFile), "../../..");
}

const PROJECT_ROOT = findMonorepoRoot();

/**
 * Returns the monorepo root so agents work with the correct cwd
 * and can find .claude/agents/ definitions.
 */
export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

/** Find the claude executable path. */
function findClaude(): string | undefined {
  const candidates = [
    resolve(process.env.HOME ?? "", ".local/bin/claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

const CLAUDE_PATH = findClaude();

/** Returns the resolved path to the claude binary, if found. */
export function getClaudePath(): string | undefined {
  return CLAUDE_PATH;
}

/**
 * Creates a PostToolUse hook callback that appends tool activity
 * to the task's agentActivityLog field.
 */
export function createActivityLogger(taskId: string): HookCallback {
  return async (input, _toolUseId, _options) => {
    const toolName =
      (input as any).tool_name ?? (input as any).tool_input?.command ?? "unknown";
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] Tool: ${toolName}`;

    log.debug({ taskId, toolName }, "Agent tool use logged");

    try {
      const db = getDb();
      const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
      const currentLog = task?.agentActivityLog ?? "";
      const updatedLog = currentLog ? `${currentLog}\n${entry}` : entry;

      db.update(tasks)
        .set({ agentActivityLog: updatedLog, updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, taskId))
        .run();
    } catch (err) {
      log.error({ err, taskId }, "Failed to update agent activity log");
    }

    return {};
  };
}

/**
 * Flush a final activity entry when the agent finishes
 * (handles the maxTurns edge case where PostToolUse won't fire).
 */
export function flushActivityLog(
  taskId: string,
  message: string
): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}`;

  log.debug({ taskId, message }, "Flushing final activity log entry");

  try {
    const db = getDb();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    const currentLog = task?.agentActivityLog ?? "";
    const updatedLog = currentLog ? `${currentLog}\n${entry}` : entry;

    db.update(tasks)
      .set({ agentActivityLog: updatedLog, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, taskId))
      .run();
  } catch (err) {
    log.error({ err, taskId }, "Failed to flush activity log");
  }
}
