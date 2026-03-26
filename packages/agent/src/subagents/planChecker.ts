import { query } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { getDb, tasks, logger } from "@aif/shared";
import { createActivityLogger, flushActivityLog, getClaudePath } from "../hooks.js";
import {
  createClaudeStderrCollector,
  explainClaudeFailure,
  probeClaudeCliFailure,
} from "../claudeDiagnostics.js";

const log = logger("plan-checker");

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

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: projectRoot,
        env: process.env,
        pathToClaudeCodeExecutable: getClaudePath(),
        settingSources: ["project"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        allowedTools: ["Read"],
        maxTurns: 8,
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
          log.info({ taskId }, "plan-checker completed successfully");
        } else {
          flushActivityLog(taskId, `Plan checker ended: ${message.subtype}`);
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

    flushActivityLog(taskId, "Plan checklist verification complete (plan-checker)");
    log.debug({ taskId }, "Verified plan saved to task");
  } catch (err) {
    let detail = stderrCollector.getTail();
    if (!detail) {
      detail = await probeClaudeCliFailure(projectRoot, getClaudePath());
    }
    const reason = explainClaudeFailure(err, detail);
    flushActivityLog(taskId, `Plan checklist verification failed: ${reason}`);
    log.error({ taskId, err, claudeStderr: detail }, "Plan checker execution failed");
    throw new Error(reason, { cause: err });
  }
}
