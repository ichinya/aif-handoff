import { query } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, tasks, taskComments, logger } from "@aif/shared";
import { createActivityLogger, flushActivityLog, getClaudePath } from "../hooks.js";
import {
  createClaudeStderrCollector,
  explainClaudeFailure,
  probeClaudeCliFailure,
} from "../claudeDiagnostics.js";

const log = logger("planner");

function extractPlanPathFromResult(resultText: string): string | null {
  const match = resultText.match(/plan written to\s+([^\n.]+(?:\.[a-z0-9]+)?)/i);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function readPlanFromDisk(projectRoot: string, resultText: string): string | null {
  const candidates = new Set<string>([
    resolve(projectRoot, ".ai-factory/PLAN.md"),
    resolve(projectRoot, ".ai-factory/FIX_PLAN.md"),
  ]);

  const pathFromResult = extractPlanPathFromResult(resultText);
  if (pathFromResult) {
    candidates.add(
      pathFromResult.startsWith("/") ? pathFromResult : resolve(projectRoot, pathFromResult)
    );
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const content = readFileSync(candidate, "utf8").trim();
    if (content.length > 0) return content;
  }

  return null;
}

function normalizePlannerResult(resultText: string): string {
  const cleaned = resultText
    .replace(/^plan written to .*$/im, "")
    .replace(/^saved to .*$/im, "")
    .trim();

  return cleaned.length > 0 ? cleaned : resultText.trim();
}

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

function formatCommentsForPrompt(
  comments: Array<{
    author: "human" | "agent";
    message: string;
    attachments: string | null;
    createdAt: string;
  }>
): string {
  if (comments.length === 0) return "No user comments were provided.";

  const recent = comments.slice(-10);
  return recent
    .map((comment, index) => {
      const attachments = parseAttachments(comment.attachments);
      const attachmentLines = attachments.length
        ? attachments
            .map((file, fileIndex) => {
              const contentBlock = file.content
                ? `\n      content:\n${file.content
                    .slice(0, 4000)
                    .split("\n")
                    .map((line) => `        ${line}`)
                    .join("\n")}`
                : "\n      content: [not provided]";
              return `    ${fileIndex + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes)${contentBlock}`;
            })
            .join("\n")
        : "    none";

      return [
        `${index + 1}. [${comment.createdAt}] ${comment.author}`,
        `   message: ${comment.message}`,
        "   attachments:",
        attachmentLines,
      ].join("\n");
    })
    .join("\n\n");
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

export async function runPlanner(taskId: string, projectRoot: string): Promise<void> {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  const comments = db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .all();

  if (!task) {
    log.error({ taskId }, "Task not found for planning");
    throw new Error(`Task ${taskId} not found`);
  }

  log.info({ taskId, title: task.title }, "Starting plan-polisher agent");

  const prompt = `Plan the implementation for the following task.
Mode: fast, tests: no, docs: no.

Title: ${task.title}
Description: ${task.description}
Task attachments:
${formatTaskAttachmentsForPrompt(task.attachments)}
User comments and replanning feedback:
${formatCommentsForPrompt(comments)}

Create a concrete, implementation-ready plan. Write it to .ai-factory/PLAN.md then return the plan text.`;

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
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        maxTurns: 12,
        maxBudgetUsd: 1.0,
        permissionMode: "acceptEdits",
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
          log.info({ taskId }, "plan-polisher completed successfully");
        } else {
          flushActivityLog(taskId, `Planner ended: ${message.subtype}`);
          log.warn({ taskId, subtype: message.subtype }, "Planner ended with non-success");
          throw new Error(`Planner failed: ${message.subtype}`);
        }
      }
    }

    const diskPlan = readPlanFromDisk(projectRoot, resultText);
    resultText = diskPlan ?? normalizePlannerResult(resultText);

    // Save plan to task
    db.update(tasks)
      .set({
        plan: resultText,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, taskId))
      .run();

    flushActivityLog(taskId, "Planning complete (plan-polisher)");
    log.debug({ taskId }, "Plan saved to task");
  } catch (err) {
    let detail = stderrCollector.getTail();
    if (!detail) {
      detail = await probeClaudeCliFailure(projectRoot, getClaudePath());
    }
    const reason = explainClaudeFailure(err, detail);
    flushActivityLog(taskId, `Planning failed: ${reason}`);
    log.error({ taskId, err, claudeStderr: detail }, "Planner execution failed");
    throw new Error(reason, { cause: err });
  }
}
