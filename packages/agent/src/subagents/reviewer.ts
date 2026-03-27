import { query } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { getDb, projects, tasks, logger } from "@aif/shared";
import { createActivityLogger, createSubagentLogger, logActivity, getClaudePath } from "../hooks.js";
import { writeQueryAudit } from "../queryAudit.js";
import {
  createClaudeStderrCollector,
  explainClaudeFailure,
  probeClaudeCliFailure,
} from "../claudeDiagnostics.js";

const log = logger("reviewer");
const PROJECT_SCOPE_SYSTEM_APPEND =
  "Project scope rule: work strictly inside the current working directory (project root). " +
  "Do not inspect or modify files in the orchestrator monorepo or in parent/sibling directories " +
  "unless the user explicitly asks for that path. Avoid broad discovery outside the current project root.";

function parseAttachments(raw: string | null): Array<{
  name: string;
  mimeType: string;
  size: number;
  content: string | null;
}> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        name: typeof item.name === "string" ? item.name : "file",
        mimeType: typeof item.mimeType === "string" ? item.mimeType : "application/octet-stream",
        size: typeof item.size === "number" ? item.size : 0,
        content: typeof item.content === "string" ? item.content : null,
      }));
  } catch {
    return [];
  }
}

function formatTaskAttachmentsForPrompt(raw: string | null): string {
  const attachments = parseAttachments(raw);
  if (attachments.length === 0) return "No task attachments were provided.";

  return attachments
    .map((file, index) => {
      const contentBlock = file.content
        ? `\n    content:\n${file.content
            .slice(0, 4000)
            .split("\n")
            .map((line) => `      ${line}`)
            .join("\n")}`
        : "\n    content: [not provided]";
      return `${index + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes)${contentBlock}`;
    })
    .join("\n");
}

async function runSidecar(
  prompt: string,
  taskId: string,
  projectRoot: string,
  agentName: string,
  maxBudgetUsd: number | null,
): Promise<string> {
  let resultText = "";
  const stderrCollector = createClaudeStderrCollector();
  logActivity(taskId, "Agent", `${agentName} started`);
  writeQueryAudit({
    timestamp: new Date().toISOString(),
    taskId,
    agentName,
    projectRoot,
    prompt,
    options: {
      settingSources: ["project"],
      maxBudgetUsd,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: PROJECT_SCOPE_SYSTEM_APPEND,
      },
    },
  });

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: projectRoot,
        env: process.env,
        pathToClaudeCodeExecutable: getClaudePath(),
        settingSources: ["project"],
        permissionMode: "acceptEdits",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: PROJECT_SCOPE_SYSTEM_APPEND,
        },
        extraArgs: { agent: agentName },
        ...(maxBudgetUsd == null ? {} : { maxBudgetUsd }),
        stderr: stderrCollector.onStderr,
        hooks: {
          PostToolUse: [
            { hooks: [createActivityLogger(taskId)] },
          ],
          SubagentStart: [
            { hooks: [createSubagentLogger(taskId)] },
          ],
        },
      },
    })) {
      if (message.type === "result") {
        if (message.subtype === "success") {
          resultText = message.result;
        } else {
          logActivity(taskId, "Agent", `${agentName} ended (${message.subtype})`);
          throw new Error(`Review agent failed: ${message.subtype}`);
        }
      }
    }
  } catch (err) {
    let detail = stderrCollector.getTail();
    if (!detail) {
      detail = await probeClaudeCliFailure(projectRoot, getClaudePath());
    }
    const reason = explainClaudeFailure(err, detail);
    logActivity(taskId, "Agent", `${agentName} failed — ${reason}`);
    throw new Error(reason, { cause: err });
  }

  logActivity(taskId, "Agent", `${agentName} complete`);
  return resultText;
}

export async function runReviewer(taskId: string, projectRoot: string): Promise<void> {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();

  if (!task) {
    log.error({ taskId }, "Task not found for review");
    throw new Error(`Task ${taskId} not found`);
  }

  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  const sidecarBudget = project?.reviewSidecarMaxBudgetUsd ?? null;

  log.info({ taskId, title: task.title }, "Starting review + security sidecars");

  const reviewPrompt = `Review the implementation for this task:

Title: ${task.title}
Description: ${task.description}
Task attachments:
${formatTaskAttachmentsForPrompt(task.attachments)}

Implementation Log:
${task.implementationLog ?? "No implementation log available."}

Review changed code for correctness, regression risks, performance, and maintainability.`;

  const securityPrompt = `Audit the implementation for security risks:

Title: ${task.title}
Description: ${task.description}
Task attachments:
${formatTaskAttachmentsForPrompt(task.attachments)}

Focus on auth, validation, secrets, injection, and unsafe shell/file handling in changed code.`;

  try {
    const heartbeatTimer = setInterval(() => {
      const nowIso = new Date().toISOString();
      db.update(tasks)
        .set({ lastHeartbeatAt: nowIso, updatedAt: nowIso })
        .where(eq(tasks.id, taskId))
        .run();
    }, 30_000);

    // Run review and security in parallel
    let reviewResult = "";
    let securityResult = "";
    try {
      [reviewResult, securityResult] = await Promise.all([
        runSidecar(reviewPrompt, taskId, projectRoot, "review-sidecar", sidecarBudget),
        runSidecar(securityPrompt, taskId, projectRoot, "security-sidecar", sidecarBudget),
      ]);
    } finally {
      clearInterval(heartbeatTimer);
    }

    log.info({ taskId }, "Review and security sidecars completed");

    const combinedReview = `## Code Review\n\n${reviewResult}\n\n## Security Audit\n\n${securityResult}`;

    db.update(tasks)
      .set({
        reviewComments: combinedReview,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, taskId))
      .run();

    logActivity(taskId, "Agent", "review stage complete (review-sidecar + security-sidecar)");
    log.debug({ taskId }, "Review comments saved to task");
  } catch (err) {
    logActivity(taskId, "Agent", `review stage failed — ${(err as Error).message}`);
    throw err;
  }
}
