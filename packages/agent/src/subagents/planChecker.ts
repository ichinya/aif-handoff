import { query } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { getDb, projects, tasks, logger } from "@aif/shared";
import { createActivityLogger, logActivity, getClaudePath } from "../hooks.js";
import { writeQueryAudit } from "../queryAudit.js";
import {
  createClaudeStderrCollector,
  explainClaudeFailure,
  probeClaudeCliFailure,
} from "../claudeDiagnostics.js";

const log = logger("plan-checker");
const AGENT_NAME = "plan-checker";
const PROJECT_SCOPE_SYSTEM_APPEND =
  "Project scope rule: work strictly inside the current working directory (project root). " +
  "Do not inspect or modify files in the orchestrator monorepo or in parent/sibling directories " +
  "unless the user explicitly asks for that path. Avoid broad discovery outside the current project root.";

function normalizeMarkdownFence(text: string): string {
  const fenced = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  if (!fenced) return text.trim();
  return fenced[1].trim();
}

export async function runPlanChecker(taskId: string, projectRoot: string): Promise<void> {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();

  if (!task) {
    log.error({ taskId }, "Task not found for plan checklist verification");
    throw new Error(`Task ${taskId} not found`);
  }

  if (!task.plan || task.plan.trim().length === 0) {
    log.warn({ taskId }, "Skipping plan checklist verification: task has no plan");
    return;
  }
  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  const planCheckerBudget = project?.planCheckerMaxBudgetUsd ?? null;

  log.info({ taskId, title: task.title }, "Starting plan-checker agent");

  const prompt = `You are validating an implementation plan markdown before coding starts.
Task title: ${task.title}

Current plan markdown:
${task.plan}

Requirements:
1) Ensure the plan is a checklist where actionable items use markdown checkboxes in "- [ ] Item" format.
2) Convert plain bullet tasks into unchecked checkboxes when needed.
3) Keep headings and non-actionable context text intact.
4) Preserve completed items "- [x]" as completed.
5) Return only the corrected plan markdown, no explanations.`;

  let resultText = "";
  const stderrCollector = createClaudeStderrCollector();
  logActivity(taskId, "Agent", `${AGENT_NAME} started`);
  writeQueryAudit({
    timestamp: new Date().toISOString(),
    taskId,
    agentName: AGENT_NAME,
    projectRoot,
    prompt,
    options: {
      settingSources: ["project"],
      maxBudgetUsd: planCheckerBudget,
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
        ...(planCheckerBudget == null ? {} : { maxBudgetUsd: planCheckerBudget }),
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
          log.info({ taskId }, "plan-checker completed successfully");
        } else {
          logActivity(taskId, "Agent", `${AGENT_NAME} ended (${message.subtype})`);
          throw new Error(`Plan checker failed: ${message.subtype}`);
        }
      }
    }

    const normalizedPlan = normalizeMarkdownFence(resultText);
    if (normalizedPlan.length === 0) {
      throw new Error("Plan checker returned empty content");
    }

    db.update(tasks)
      .set({
        plan: normalizedPlan,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, taskId))
      .run();

    logActivity(taskId, "Agent", `${AGENT_NAME} complete`);
    log.debug({ taskId }, "Verified plan saved to task");
  } catch (err) {
    let detail = stderrCollector.getTail();
    if (!detail) {
      detail = await probeClaudeCliFailure(projectRoot, getClaudePath());
    }
    const reason = explainClaudeFailure(err, detail);
    logActivity(taskId, "Agent", `${AGENT_NAME} failed — ${reason}`);
    log.error({ taskId, err, claudeStderr: detail }, "Plan checker execution failed");
    throw new Error(reason, { cause: err });
  }
}
