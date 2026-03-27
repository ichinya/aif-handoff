import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, tasks, projects, logger, initProjectDirectory, getEnv, type TaskStatus } from "@aif/shared";
import { runPlanner } from "./subagents/planner.js";
import { runPlanChecker } from "./subagents/planChecker.js";
import { runImplementer } from "./subagents/implementer.js";
import { runReviewer } from "./subagents/reviewer.js";
import { notifyTaskBroadcast } from "./notifier.js";

const log = logger("coordinator");
const env = getEnv();
const STALE_TIMEOUT_MS = Math.max(env.AGENT_STAGE_STALE_TIMEOUT_MS, 60_000);
const STALE_MAX_RETRY = Math.max(env.AGENT_STAGE_STALE_MAX_RETRY, 1);
const STAGE_RUN_TIMEOUT_MS = Math.max(env.AGENT_STAGE_RUN_TIMEOUT_MS, 60_000);

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
    lower.includes("exited with code 1") ||
    lower.includes("timed out") ||
    lower.includes("stream interrupted") ||
    lower.includes("stream closed") ||
    lower.includes("error in hook callback") ||
    lower.includes("permission denied") ||
    lower.includes("blocked by permissions") ||
    lower.includes("write permission")
  );
}

function getRandomBackoffMinutes(): number {
  return Math.floor(Math.random() * 11) + 5; // 5..15
}

async function runStageWithTimeout(
  runner: (taskId: string, projectRoot: string) => Promise<void>,
  taskId: string,
  projectRoot: string,
  stageLabel: string,
): Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      runner(taskId, projectRoot),
      new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Stage ${stageLabel} timed out after ${STAGE_RUN_TIMEOUT_MS}ms`));
        }, STAGE_RUN_TIMEOUT_MS);
        timeoutId.unref?.();
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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
        lastHeartbeatAt: nowIso,
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

function getResumeStatusForStaleTask(status: TaskStatus): TaskStatus {
  if (status === "implementing") return "plan_ready";
  return status;
}

function parseUpdatedAtMs(value: string): number | null {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const normalized = !hasTimezone && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function recoverStaleInProgressTasks(db: ReturnType<typeof getDb>): void {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const candidates = db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, ["planning", "implementing", "review"]))
    .all();

  for (const task of candidates) {
    const heartbeatMs = task.lastHeartbeatAt ? parseUpdatedAtMs(task.lastHeartbeatAt) : null;
    const updatedAtMs = parseUpdatedAtMs(task.updatedAt);
    const referenceMs = heartbeatMs ?? updatedAtMs;
    if (referenceMs == null) continue;

    const ageMs = now - referenceMs;
    if (ageMs < STALE_TIMEOUT_MS) continue;

    const retryCount = task.retryCount ?? 0;
    const resumeStatus = getResumeStatusForStaleTask(task.status);
    const ageMinutes = Math.floor(ageMs / 60_000);
    const reasonBase = `Watchdog: task stale in ${task.status} for ${ageMinutes}m`;

    if (retryCount >= STALE_MAX_RETRY) {
      db.update(tasks)
        .set({
          status: "blocked_external",
          blockedReason: `${reasonBase}; auto-retry limit reached (${STALE_MAX_RETRY})`,
          blockedFromStatus: resumeStatus,
          retryAfter: null,
          lastHeartbeatAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(tasks.id, task.id))
        .run();
      void notifyTaskBroadcast(task.id, "task:moved");

      log.error(
        { taskId: task.id, status: task.status, retryCount, staleMinutes: ageMinutes },
        "Task quarantined by stale watchdog after max retries"
      );
      continue;
    }

    const backoffMinutes = getRandomBackoffMinutes();
    const retryAfter = new Date(now + backoffMinutes * 60_000).toISOString();
    db.update(tasks)
      .set({
        status: "blocked_external",
        blockedReason: `${reasonBase}; auto-recover scheduled`,
        blockedFromStatus: resumeStatus,
        retryAfter,
        retryCount: retryCount + 1,
        lastHeartbeatAt: nowIso,
        updatedAt: nowIso,
      })
      .where(eq(tasks.id, task.id))
      .run();
    void notifyTaskBroadcast(task.id, "task:moved");

    log.warn(
      {
        taskId: task.id,
        status: task.status,
        staleMinutes: ageMinutes,
        retryAfter,
        nextStatus: resumeStatus,
        retryCount: retryCount + 1,
      },
      "Task recovered by stale watchdog"
    );
  }
}

export async function pollAndProcess(): Promise<void> {
  const db = getDb();

  log.debug("Starting poll cycle");
  releaseDueBlockedTasks(db);
  recoverStaleInProgressTasks(db);

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

    // Ensure project directory is initialized (.claude/agents, .claude/skills, git)
    initProjectDirectory(project.rootPath);

    log.info(
      { taskId: task.id, title: task.title, stage: stage.label, projectRoot: project.rootPath },
      "Picked up task for processing"
    );
    const sourceStatus = task.status;

    // Set intermediate status
    db.update(tasks)
      .set({
        status: stage.inProgress,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, task.id))
      .run();
    void notifyTaskBroadcast(task.id, "task:moved");

    log.debug(
      { taskId: task.id, from: sourceStatus, to: stage.inProgress },
      "Status transition (start)"
    );

    try {
      await runStageWithTimeout(stage.runner, task.id, project.rootPath, stage.label);

      // Success — move to next status
      db.update(tasks)
        .set({
          status: stage.onSuccess,
          blockedReason: null,
          blockedFromStatus: null,
          retryAfter: null,
          lastHeartbeatAt: new Date().toISOString(),
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
            lastHeartbeatAt: new Date().toISOString(),
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
          .set({
            status: sourceStatus,
            lastHeartbeatAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
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
