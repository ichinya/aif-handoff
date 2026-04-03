import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger, getEnv, findClaudePath } from "@aif/shared";
import { findProjectById } from "@aif/data";

const log = logger("commit-generation");
const CLAUDE_PATH = findClaudePath();

const PROJECT_SCOPE_APPEND =
  "Project scope rule: work strictly inside the current working directory (project root). " +
  "Do not inspect or modify files in the orchestrator monorepo or in parent/sibling directories " +
  "unless the user explicitly asks for that path. Avoid broad discovery outside the current project root.";

/**
 * Fire-and-forget: run `/aif-commit` via Agent SDK in the project root.
 * Logs errors but never throws — caller should not await or depend on success.
 */
export async function runCommitQuery(projectId: string): Promise<void> {
  const project = findProjectById(projectId);
  if (!project) {
    log.error({ projectId }, "Project not found for commit generation");
    return;
  }

  const bypassPermissions = getEnv().AGENT_BYPASS_PERMISSIONS;

  log.info({ projectId, projectRoot: project.rootPath }, "Starting /aif-commit via Agent SDK");

  try {
    for await (const message of query({
      prompt: "/aif-commit",
      options: {
        ...(CLAUDE_PATH ? { pathToClaudeCodeExecutable: CLAUDE_PATH } : {}),
        cwd: project.rootPath,
        env: { ...process.env, HANDOFF_MODE: "1" },
        settings: { attribution: { commit: "", pr: "" } },
        settingSources: ["project"],
        permissionMode: bypassPermissions ? "bypassPermissions" : "acceptEdits",
        ...(bypassPermissions ? { allowDangerouslySkipPermissions: true } : {}),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: PROJECT_SCOPE_APPEND,
        },
      },
    })) {
      if (message.type !== "result") continue;
      if (message.subtype === "success") {
        log.info({ projectId }, "/aif-commit completed successfully");
      } else {
        log.warn({ projectId, subtype: message.subtype }, "/aif-commit ended with non-success");
      }
    }
  } catch (err) {
    log.error({ err, projectId }, "/aif-commit Agent SDK error");
  }
}
