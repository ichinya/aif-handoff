import { mkdirSync } from "fs";
import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, tasks, projects, logger, type TaskStatus } from "@aif/shared";
import { runPlanner } from "./subagents/planner.js";
import { runPlanChecker } from "./subagents/planChecker.js";
import { runImplementer } from "./subagents/implementer.js";
import { runReviewer } from "./subagents/reviewer.js";
import { notifyTaskBroadcast } from "./notifier.js";

const log = logger("coordinator");

interface StatusTransition {
  from: TaskStatus[];
  inProgress: TaskStatus;
  onSuccess: TaskStatus;
  runner: (taskId: string, projectRoot: string) => Promise<void>;
  label: string;
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
    inProgress: "review", // stays in review during processing
    onSuccess: "done",
    runner: runReviewer,
    label: "reviewer",
  },
];

function isExternalFailure(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  const lower = text.toLowerCase();
  return (
    lower.includes("not logged in") ||
    lower.includes("usage limit") ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("credits") ||
    lower.includes("exited with code 1")
  );
}

function getRandomBackoffMinutes(): number {
  return Math.floor(Math.random() * 11) + 5; // 5..15
}

function releaseDueBlockedTasks(db: ReturnType<typeof getDb>): void {
  const nowIso = new Date().toISOString();
  const blockedTasks = db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "blocked_external"))
    .all();

  for (const task of blockedTasks) {
    if (!task.retryAfter || task.retryAfter > nowIso) continue;
    if (!task.blockedFromStatus) continue;

    db.update(tasks)
      .set({
        status: task.blockedFromStatus,
        blockedReason: null,
        blockedFromStatus: null,
        retryAfter: null,
        updatedAt: nowIso,
      })
      .where(eq(tasks.id, task.id))
      .run();
    void notifyTaskBroadcast(task.id, "task:moved");

    log.info(
      { taskId: task.id, restoreTo: task.blockedFromStatus },
      "Task released from blocked_external after backoff"
    );
  }
}

export async function pollAndProcess(): Promise<void> {
  const db = getDb();

  log.debug("Starting poll cycle");
  releaseDueBlockedTasks(db);

  for (const stage of PIPELINE) {
    // Find one task at the source status
    const stageFilter =
      stage.label === "implementer"
        ? or(
            eq(tasks.status, "implementing"),
            and(eq(tasks.status, "plan_ready"), eq(tasks.autoMode, true))
          )
        : stage.label === "plan-checker"
          ? and(eq(tasks.status, "plan_ready"), eq(tasks.autoMode, true))
          : inArray(tasks.status, stage.from);

    const task = db
      .select()
      .from(tasks)
      .where(stageFilter)
      .limit(1)
      .get();

    if (!task) {
      log.debug({ stage: stage.label }, "No tasks to process");
      continue;
    }

    // Get the project's rootPath
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .get();

    if (!project) {
      log.error({ taskId: task.id, projectId: task.projectId }, "Project not found for task, skipping");
      continue;
    }

    // Ensure project directory exists
    mkdirSync(project.rootPath, { recursive: true });

    log.info(
      { taskId: task.id, title: task.title, stage: stage.label, projectRoot: project.rootPath },
      "Picked up task for processing"
    );
    const sourceStatus = task.status;

    // Set intermediate status
    db.update(tasks)
      .set({ status: stage.inProgress, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, task.id))
      .run();
    void notifyTaskBroadcast(task.id, "task:moved");

    log.debug(
      { taskId: task.id, from: sourceStatus, to: stage.inProgress },
      "Status transition (start)"
    );

    try {
      await stage.runner(task.id, project.rootPath);

      // Success — move to next status
      db.update(tasks)
        .set({
          status: stage.onSuccess,
          blockedReason: null,
          blockedFromStatus: null,
          retryAfter: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, task.id))
        .run();
      void notifyTaskBroadcast(task.id, "task:moved");

      log.info(
        { taskId: task.id, from: stage.inProgress, to: stage.onSuccess },
        "Status transition (success)"
      );
    } catch (err) {
      if (isExternalFailure(err)) {
        const backoffMinutes = getRandomBackoffMinutes();
        const retryAfter = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
        const reason = err instanceof Error ? err.message : String(err);

        db.update(tasks)
          .set({
            status: "blocked_external",
            blockedReason: reason,
            blockedFromStatus: sourceStatus,
            retryAfter,
            retryCount: (task.retryCount ?? 0) + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(tasks.id, task.id))
          .run();
        void notifyTaskBroadcast(task.id, "task:moved");

        log.error(
          { taskId: task.id, stage: stage.label, err, retryAfter, backoffMinutes },
          "Subagent failed with external error, task blocked with backoff"
        );
      } else {
        // Failure — revert to previous status
        db.update(tasks)
          .set({ status: sourceStatus, updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, task.id))
          .run();
        void notifyTaskBroadcast(task.id, "task:moved");

        log.error(
          { taskId: task.id, stage: stage.label, err },
          "Subagent failed, reverting status"
        );
      }

      // Stop current poll cycle after a failed stage to avoid immediately
      // re-picking the same task in a downstream stage in this same cycle.
      break;
    }
  }

  log.debug("Poll cycle complete");
}
