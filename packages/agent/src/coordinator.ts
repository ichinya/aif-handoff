import {
  findCoordinatorTaskCandidate,
  findProjectById,
  updateTaskStatus as updateTaskStatusRow,
  type CoordinatorStage,
  type TaskFieldsPatch,
} from "@aif/data";
import {
  logger,
  initProjectDirectory,
  getEnv,
  CLEAN_STATE_RESET,
  withTimeout,
  type TaskStatus,
} from "@aif/shared";
import { runPlanner } from "./subagents/planner.js";
import { runPlanChecker } from "./subagents/planChecker.js";
import { runImplementer } from "./subagents/implementer.js";
import { runReviewer } from "./subagents/reviewer.js";
import { flushActivityQueue } from "./hooks.js";
import { notifyTaskBroadcast, type TaskNotificationInfo } from "./notifier.js";
import { handleAutoReviewGate } from "./autoReviewHandler.js";
import { classifyStageError } from "./stageErrorHandler.js";
import { releaseDueBlockedTasks, recoverStaleInProgressTasks } from "./taskWatchdog.js";

const log = logger("coordinator");
const env = getEnv();
const STAGE_RUN_TIMEOUT_MS = Math.max(env.AGENT_STAGE_RUN_TIMEOUT_MS, 60_000);

const runtimeCounters = {
  fastRetryStreamInterruptions: 0,
};

interface StatusTransition {
  from: TaskStatus[];
  inProgress: TaskStatus;
  onSuccess: TaskStatus;
  runner: (taskId: string, projectRoot: string) => Promise<void>;
  label: CoordinatorStage;
}

const PIPELINE: StatusTransition[] = [
  {
    from: ["planning"],
    inProgress: "planning",
    onSuccess: "plan_ready",
    runner: runPlanner,
    label: "planner",
  },
  {
    from: ["plan_ready"],
    inProgress: "plan_ready",
    onSuccess: "plan_ready",
    runner: runPlanChecker,
    label: "plan-checker",
  },
  {
    from: ["plan_ready", "implementing"],
    inProgress: "implementing",
    onSuccess: "review",
    runner: runImplementer,
    label: "implementer",
  },
  {
    from: ["review"],
    inProgress: "review",
    onSuccess: "done",
    runner: runReviewer,
    label: "reviewer",
  },
];

export function getCoordinatorRuntimeCounters(): Readonly<typeof runtimeCounters> {
  return { ...runtimeCounters };
}

export function resetCoordinatorRuntimeCountersForTests(): void {
  runtimeCounters.fastRetryStreamInterruptions = 0;
}

async function runStageWithTimeout(
  runner: (taskId: string, projectRoot: string) => Promise<void>,
  taskId: string,
  projectRoot: string,
  stageLabel: string,
): Promise<void> {
  await withTimeout(
    runner(taskId, projectRoot),
    STAGE_RUN_TIMEOUT_MS,
    `Stage ${stageLabel} timed out after ${STAGE_RUN_TIMEOUT_MS}ms`,
  );
}

/** Update task status with optional field overrides and broadcast. */
function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  extra: Omit<TaskFieldsPatch, "status" | "lastHeartbeatAt" | "updatedAt"> = {},
  info: TaskNotificationInfo = {},
): void {
  updateTaskStatusRow(taskId, status, extra);
  void notifyTaskBroadcast(taskId, "task:moved", { ...info, toStatus: status });
}

export async function pollAndProcess(): Promise<void> {
  log.debug("Starting poll cycle");
  releaseDueBlockedTasks();
  recoverStaleInProgressTasks();

  for (const stage of PIPELINE) {
    const task = findCoordinatorTaskCandidate(stage.label);

    if (!task) {
      log.debug({ stage: stage.label }, "No tasks to process");
      continue;
    }

    log.debug(
      { stage: stage.label, taskId: task.id, candidateStatus: task.status },
      "Task candidate selected",
    );

    const project = findProjectById(task.projectId);

    if (!project) {
      log.error(
        { taskId: task.id, projectId: task.projectId },
        "Project not found for task, skipping",
      );
      continue;
    }

    initProjectDirectory(project.rootPath);

    log.info(
      { taskId: task.id, title: task.title, stage: stage.label, projectRoot: project.rootPath },
      "Picked up task for processing",
    );
    const sourceStatus = task.status;
    const taskTitle = task.title;

    updateTaskStatus(task.id, stage.inProgress, {}, { title: taskTitle, fromStatus: sourceStatus });

    log.debug(
      { taskId: task.id, from: sourceStatus, to: stage.inProgress },
      "Status transition (start)",
    );

    try {
      await runStageWithTimeout(stage.runner, task.id, project.rootPath, stage.label);

      flushActivityQueue(task.id);

      // Skip review: if task has skipReview, jump straight to done after implementing
      if (stage.label === "implementer" && task.skipReview) {
        updateTaskStatus(task.id, "done", CLEAN_STATE_RESET, {
          title: taskTitle,
          fromStatus: stage.inProgress,
        });
        log.info(
          { taskId: task.id, from: stage.inProgress, to: "done" },
          "Skip review enabled — bypassing review stage",
        );
        continue;
      }

      // Auto review gate: after reviewer in autoMode, decide accept vs rework
      if (stage.label === "reviewer") {
        const outcome = await handleAutoReviewGate({
          taskId: task.id,
          projectRoot: project.rootPath,
        });

        if (outcome === "max_iterations_reached") {
          updateTaskStatus(task.id, "done", CLEAN_STATE_RESET, {
            title: taskTitle,
            fromStatus: stage.inProgress,
          });

          log.info(
            { taskId: task.id, from: stage.inProgress, to: "done" },
            "Auto review gate: max iterations reached, moving to done",
          );
          continue;
        }

        if (outcome === "rework_requested") {
          const currentCount = task.reviewIterationCount ?? 0;
          updateTaskStatus(
            task.id,
            "implementing",
            {
              ...CLEAN_STATE_RESET,
              reworkRequested: true,
              reviewIterationCount: currentCount + 1,
            },
            { title: taskTitle, fromStatus: stage.inProgress },
          );

          log.info(
            {
              taskId: task.id,
              from: stage.inProgress,
              to: "implementing",
              reviewIteration: currentCount + 1,
            },
            "Auto review gate requested changes, restarting implementing stage",
          );
          continue;
        }
      }

      updateTaskStatus(
        task.id,
        stage.onSuccess,
        {
          ...CLEAN_STATE_RESET,
          // Preserve review iteration count when transitioning implementing → review
          // so the auto review gate can enforce max iterations across rework cycles.
          reviewIterationCount:
            stage.label === "implementer" ? (task.reviewIterationCount ?? 0) : 0,
        },
        { title: taskTitle, fromStatus: stage.inProgress },
      );

      log.info(
        { taskId: task.id, from: stage.inProgress, to: stage.onSuccess },
        "Status transition (success)",
      );
    } catch (err) {
      const recovery = classifyStageError({
        taskId: task.id,
        stageLabel: stage.label,
        sourceStatus,
        retryCount: task.retryCount ?? 0,
        err,
      });

      switch (recovery.kind) {
        case "fast_retry":
          runtimeCounters.fastRetryStreamInterruptions += 1;
          log.warn(
            {
              taskId: task.id,
              stage: stage.label,
              metric: "coordinator.fast_retry_stream_interruptions",
              fastRetryStreamInterruptions: runtimeCounters.fastRetryStreamInterruptions,
            },
            "Fast retry scheduled after transient stream interruption",
          );
          updateTaskStatus(
            task.id,
            stage.inProgress,
            {
              blockedReason: null,
              blockedFromStatus: null,
              retryAfter: null,
            },
            { title: taskTitle, fromStatus: stage.inProgress },
          );
          break;

        case "blocked_external":
          updateTaskStatus(
            task.id,
            "blocked_external",
            {
              blockedReason: err instanceof Error ? err.message : String(err),
              blockedFromStatus: stage.inProgress,
              retryAfter: recovery.retryAfter,
              retryCount: recovery.retryCount,
            },
            { title: taskTitle, fromStatus: stage.inProgress },
          );
          break;

        case "revert":
          updateTaskStatus(
            task.id,
            stage.inProgress,
            {},
            { title: taskTitle, fromStatus: stage.inProgress },
          );
          break;
      }

      flushActivityQueue(task.id);

      // Stop current poll cycle after a failed stage to avoid immediately
      // re-picking the same task in a downstream stage in this same cycle.
      break;
    }
  }

  log.debug("Poll cycle complete");
}
