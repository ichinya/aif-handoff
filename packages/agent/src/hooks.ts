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

/** Log categories for activity entries. */
export type ActivityCategory = "Tool" | "Agent" | "Subagent";

/**
 * Append a structured activity entry to the task's agentActivityLog.
 * Format: `[timestamp] Category: detail`
 */
export function logActivity(taskId: string, category: ActivityCategory, detail: string): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${category}: ${detail}`;

  log.debug({ taskId, category, detail }, "Activity logged");

  try {
    const db = getDb();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    const currentLog = task?.agentActivityLog ?? "";
    const updatedLog = currentLog ? `${currentLog}\n${entry}` : entry;

    db.update(tasks)
      .set({
        agentActivityLog: updatedLog,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, taskId))
      .run();
  } catch (err) {
    log.error({ err, taskId }, "Failed to update agent activity log");
  }
}

/** Extract a concise detail from tool_input based on tool name. */
function summarizeToolInput(toolName: string, toolInput: Record<string, unknown> | undefined): string {
  if (!toolInput) return "";

  switch (toolName) {
    case "Bash": {
      const cmd = String(toolInput.command ?? "").slice(0, 200);
      return cmd ? ` \`${cmd}\`` : "";
    }
    case "Read":
    case "Write":
    case "Edit":
      return toolInput.file_path ? ` ${toolInput.file_path}` : "";
    case "Glob":
      return toolInput.pattern ? ` ${toolInput.pattern}` : "";
    case "Grep":
      return toolInput.pattern ? ` /${toolInput.pattern}/` : "";
    case "Agent": {
      const desc = toolInput.description ?? toolInput.subagent_type ?? "";
      return desc ? ` ${desc}` : "";
    }
    default:
      return "";
  }
}

function buildHookLogContext(data: Record<string, unknown>): Record<string, unknown> {
  const toolInput = (data.tool_input && typeof data.tool_input === "object"
    ? (data.tool_input as Record<string, unknown>)
    : undefined);
  const toolResponse = (data.tool_response && typeof data.tool_response === "object"
    ? (data.tool_response as Record<string, unknown>)
    : undefined);

  return {
    session_id: data.session_id,
    agent_type: data.agent_type,
    hook_event_name: data.hook_event_name,
    tool_name: data.tool_name,
    tool_use_id: data.tool_use_id,
    cwd: data.cwd,
    permission_mode: data.permission_mode,
    transcript_path: data.transcript_path,
    tool_input: toolInput
      ? {
          file_path: toolInput.file_path,
          pattern: toolInput.pattern,
          command: typeof toolInput.command === "string"
            ? toolInput.command.slice(0, 200)
            : undefined,
        }
      : undefined,
    tool_response: toolResponse
      ? {
          type: toolResponse.type,
          // Explicitly avoid logging response payload/content to keep logs small and safe.
          has_file: Boolean(toolResponse.file),
          has_content: Boolean(
            toolResponse.content ||
            (toolResponse.file &&
              typeof toolResponse.file === "object" &&
              (toolResponse.file as Record<string, unknown>).content),
          ),
        }
      : undefined,
  };
}

/**
 * Creates a PostToolUse hook callback that logs tool activity.
 */
export function createActivityLogger(taskId: string): HookCallback {
  return async (input, _toolUseId, _options) => {
    const data = input as Record<string, unknown>;
    const toolName = String(data.tool_name ?? "unknown");
    const toolInput = data.tool_input as Record<string, unknown> | undefined;
    const detail = summarizeToolInput(toolName, toolInput);

    log.debug({ taskId, toolName, hookInput: buildHookLogContext(data) }, "Agent tool use logged");

    logActivity(taskId, "Tool", `${toolName}${detail}`);
    return {};
  };
}

/**
 * Creates a SubagentStart hook callback that logs subagent spawns.
 */
export function createSubagentLogger(taskId: string): HookCallback {
  return async (input, _toolUseId, _options) => {
    const data = input as Record<string, unknown>;
    const agentName = String(
      data.agent_name ?? data.subagent_type ?? data.agent_type ?? data.description ?? "unknown",
    );
    const agentId = String(data.agent_id ?? data.session_id ?? "");
    const idSuffix = agentId ? ` (${agentId.slice(0, 8)})` : "";

    log.info({ taskId, agentName, hookInput: buildHookLogContext(data) }, "Subagent started");

    logActivity(taskId, "Subagent", `${agentName} started${idSuffix}`);
    return {};
  };
}
