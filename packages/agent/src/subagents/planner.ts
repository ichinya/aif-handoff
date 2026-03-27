import { query } from "@anthropic-ai/claude-agent-sdk";
import { asc, eq } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, projects, tasks, taskComments, logger } from "@aif/shared";
import { createActivityLogger, createSubagentLogger, logActivity, getClaudePath } from "../hooks.js";
import { writeQueryAudit } from "../queryAudit.js";
import {
  createClaudeStderrCollector,
  explainClaudeFailure,
  probeClaudeCliFailure,
} from "../claudeDiagnostics.js";

const log = logger("planner");
const AGENT_NAME = "plan-coordinator";
const FIX_SKILL_NAME = "aif-fix";
const PROJECT_SCOPE_SYSTEM_APPEND =
  "Project scope rule: work strictly inside the current working directory (project root). " +
  "Do not inspect or modify files in the orchestrator monorepo or in parent/sibling directories " +
  "unless the user explicitly asks for that path. Avoid broad discovery outside the current project root.";

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

  const latest = comments.slice(-1);
  return latest
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

function buildFixCommandText(title: string, description: string): string {
  const normalizedDescription = description.trim();
  const taskText = normalizedDescription.length > 0
    ? `${title.trim()}\n\n${normalizedDescription}`
    : title.trim();
  return `/aif-fix --plan-first ${JSON.stringify(taskText)}`;
}

export async function runPlanner(taskId: string, projectRoot: string): Promise<void> {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  const comments = db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
    .all();

  if (!task) {
    log.error({ taskId }, "Task not found for planning");
    throw new Error(`Task ${taskId} not found`);
  }

  const executionName = task.isFix ? FIX_SKILL_NAME : AGENT_NAME;
  log.info({ taskId, title: task.title, isFix: task.isFix }, "Starting planning flow");
  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  const plannerBudget = project?.plannerMaxBudgetUsd ?? null;

  const hasComments = comments.length > 0;
  const isReplanning = hasComments || (task.plan && task.plan.trim().length > 0);

  const taskAttachmentsForPrompt = formatTaskAttachmentsForPrompt(task.attachments);
  const commentsForPrompt = formatCommentsForPrompt(comments);
  const prompt = task.isFix
    ? buildFixCommandText(task.title, task.description)
    : isReplanning
    ? `Refine and improve the existing plan for the following task.
Mode: fast, tests: no, docs: no, max_iterations: 3.

Title: ${task.title}
Description: ${task.description}
Task attachments:
${taskAttachmentsForPrompt}
User comments and replanning feedback:
${commentsForPrompt}

Previous plan:
${task.plan ?? "(no previous plan)"}

Iterate on the plan using plan-polisher: critique the existing plan, address the feedback above, and refine until implementation-ready.`
    : `Plan the implementation for the following task.
Mode: fast, tests: no, docs: no, max_iterations: 3.

Title: ${task.title}
Description: ${task.description}
Task attachments:
${taskAttachmentsForPrompt}
User comments and replanning feedback:
${commentsForPrompt}

Create a concrete, implementation-ready plan using iterative refinement via plan-polisher.`;

  let resultText = "";
  const stderrCollector = createClaudeStderrCollector();
  const heartbeatTimer = setInterval(() => {
    const nowIso = new Date().toISOString();
    db.update(tasks)
      .set({ lastHeartbeatAt: nowIso, updatedAt: nowIso })
      .where(eq(tasks.id, taskId))
      .run();
  }, 30_000);
  logActivity(taskId, "Agent", `${executionName} started`);
  writeQueryAudit({
    timestamp: new Date().toISOString(),
    taskId,
    agentName: executionName,
    projectRoot,
    prompt,
    options: {
      settingSources: ["project"],
      maxBudgetUsd: plannerBudget,
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
        ...(task.isFix ? {} : { extraArgs: { agent: AGENT_NAME } }),
        ...(plannerBudget == null ? {} : { maxBudgetUsd: plannerBudget }),
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
          log.info({ taskId, executionName }, "Planning flow completed successfully");
        } else {
          logActivity(taskId, "Agent", `${executionName} ended (${message.subtype})`);
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

    logActivity(taskId, "Agent", `${executionName} complete`);
    log.debug({ taskId }, "Plan saved to task");
  } catch (err) {
    let detail = stderrCollector.getTail();
    if (!detail) {
      detail = await probeClaudeCliFailure(projectRoot, getClaudePath());
    }
    const reason = explainClaudeFailure(err, detail);
    logActivity(taskId, "Agent", `${executionName} failed — ${reason}`);
    log.error({ taskId, err, claudeStderr: detail }, "Planner execution failed");
    throw new Error(reason, { cause: err });
  } finally {
    clearInterval(heartbeatTimer);
  }
}
