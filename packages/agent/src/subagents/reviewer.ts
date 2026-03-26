import { query } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { getDb, tasks, logger } from "@aif/shared";
import { createActivityLogger, flushActivityLog, getClaudePath } from "../hooks.js";
import {
  createClaudeStderrCollector,
  explainClaudeFailure,
  probeClaudeCliFailure,
} from "../claudeDiagnostics.js";

const log = logger("reviewer");

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
): Promise<string> {
  let resultText = "";
  const stderrCollector = createClaudeStderrCollector();

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: projectRoot,
        env: process.env,
        pathToClaudeCodeExecutable: getClaudePath(),
        settingSources: ["project"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        allowedTools: ["Read", "Glob", "Grep"],
        maxTurns: 6,
        maxBudgetUsd: 0.5,
        permissionMode: "dontAsk",
        stderr: stderrCollector.onStderr,
        hooks: {
          PostToolUse: [
            { hooks: [createActivityLogger(taskId)] },
          ],
        },
      },
    })) {
      if (message.type === "result") {
        if (message.subtype === "success") {
          resultText = message.result;
        } else {
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
    throw new Error(reason, { cause: err });
  }

  return resultText;
}

export async function runReviewer(taskId: string, projectRoot: string): Promise<void> {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();

  if (!task) {
    log.error({ taskId }, "Task not found for review");
    throw new Error(`Task ${taskId} not found`);
  }

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
    // Run review and security in parallel
    const [reviewResult, securityResult] = await Promise.all([
      runSidecar(reviewPrompt, taskId, projectRoot),
      runSidecar(securityPrompt, taskId, projectRoot),
    ]);

    log.info({ taskId }, "Review and security sidecars completed");

    const combinedReview = `## Code Review\n\n${reviewResult}\n\n## Security Audit\n\n${securityResult}`;

    db.update(tasks)
      .set({
        reviewComments: combinedReview,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, taskId))
      .run();

    flushActivityLog(taskId, "Review complete (review + security sidecars)");
    log.debug({ taskId }, "Review comments saved to task");
  } catch (err) {
    flushActivityLog(taskId, `Review failed: ${(err as Error).message}`);
    throw err;
  }
}
