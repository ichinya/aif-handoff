/**
 * Auto review gate handler — evaluates review comments in autoMode
 * and decides whether to accept or request rework.
 * Extracted from coordinator.ts for single responsibility.
 */

import { createTaskComment, findTaskById } from "@aif/data";
import { logger } from "@aif/shared";
import { logActivity } from "./hooks.js";
import { evaluateReviewCommentsForAutoMode } from "./reviewGate.js";

const log = logger("auto-review-handler");

export type ReviewGateOutcome = "accepted" | "rework_requested" | "max_iterations_reached";

interface AutoReviewInput {
  taskId: string;
  projectRoot: string;
}

/**
 * Run the auto review gate for a task in autoMode.
 * Returns "accepted" if the review passed, "rework_requested" if fixes are needed.
 * Returns null if the task is not in autoMode (caller should proceed normally).
 */
export async function handleAutoReviewGate(
  input: AutoReviewInput,
): Promise<ReviewGateOutcome | null> {
  const refreshedTask = findTaskById(input.taskId);

  if (!refreshedTask?.autoMode) {
    return null;
  }

  logActivity(
    input.taskId,
    "Agent",
    "coordinator auto review gate started: validating review comments before done transition",
  );

  const reviewGate = await evaluateReviewCommentsForAutoMode({
    taskId: input.taskId,
    projectRoot: input.projectRoot,
    reviewComments: refreshedTask.reviewComments,
  });

  if (reviewGate.status === "request_changes") {
    const requestedFixesCount = reviewGate.fixes
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- ")).length;

    const currentIteration = (refreshedTask.reviewIterationCount ?? 0) + 1;
    const maxIterations = refreshedTask.maxReviewIterations ?? 3;

    if (currentIteration >= maxIterations) {
      createTaskComment({
        taskId: input.taskId,
        author: "agent",
        message: [
          "## Auto Review Gate Summary",
          `- Outcome: max_iterations_reached (${currentIteration}/${maxIterations})`,
          `- Unresolved fixes: ${requestedFixesCount}`,
          "",
          "Maximum review iterations reached. Moving task to Done without resolving all review comments.",
          "",
          "## Unresolved Fixes",
          reviewGate.fixes,
        ].join("\n"),
        attachments: [],
      });

      logActivity(
        input.taskId,
        "Agent",
        `coordinator auto review gate: max iterations reached (${currentIteration}/${maxIterations}), moving to done with unresolved fixes`,
      );

      log.warn(
        {
          taskId: input.taskId,
          iteration: currentIteration,
          maxIterations,
          fixesCount: requestedFixesCount,
        },
        "Max review iterations reached, moving to done",
      );

      return "max_iterations_reached";
    }

    const reviewSummary = [
      "## Auto Review Gate Summary",
      "- Outcome: request_changes",
      `- Required fixes: ${requestedFixesCount}`,
      `- Review iteration: ${currentIteration}/${maxIterations}`,
      "",
      "## Required Fixes",
      reviewGate.fixes,
    ].join("\n");

    createTaskComment({
      taskId: input.taskId,
      author: "agent",
      message: reviewSummary,
      attachments: [],
    });

    logActivity(
      input.taskId,
      "Agent",
      `coordinator auto review gate requested changes (${requestedFixesCount} items, iteration ${currentIteration}/${maxIterations}), returning to implementing`,
    );

    log.info(
      {
        taskId: input.taskId,
        fixesCount: requestedFixesCount,
        iteration: currentIteration,
        maxIterations,
      },
      "Auto review gate requested changes, returning to implementing",
    );

    return "rework_requested";
  }

  createTaskComment({
    taskId: input.taskId,
    author: "agent",
    message: [
      "## Auto Review Gate Summary",
      "- Outcome: success",
      "- Required fixes: 0",
      "",
      "Review comments passed auto-gate; transitioning task to Done.",
    ].join("\n"),
    attachments: [],
  });

  logActivity(
    input.taskId,
    "Agent",
    "coordinator auto review gate passed: review accepted, proceeding to done",
  );

  return "accepted";
}
