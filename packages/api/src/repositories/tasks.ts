import { existsSync, readFileSync } from "node:fs";
import { getCanonicalPlanPath } from "@aif/shared";
import {
  createTask,
  createTaskComment,
  deleteTask,
  findProjectByTaskId,
  findTaskById,
  listTaskComments as listComments,
  listTasks,
  persistTaskPlanForTask,
  toCommentResponse,
  toTaskResponse,
  type TaskRow,
  type CommentRow,
  updateTask,
} from "@aif/data";

export function updateTaskPlan(taskId: string, planText: string | null, isFix: boolean): void {
  const project = findProjectByTaskId(taskId);
  if (!project) throw new Error("Project not found for task");

  persistTaskPlanForTask({
    taskId,
    planText,
    projectRoot: project.rootPath,
    isFix,
    updatedAt: new Date().toISOString(),
  });
}

export function getTaskPlanFileStatus(taskId: string) {
  const task = findTaskById(taskId);
  if (!task) return null;

  const project = findProjectByTaskId(taskId);
  if (!project) return null;

  const canonicalPlanPath = getCanonicalPlanPath({
    projectRoot: project.rootPath,
    isFix: task.isFix,
  });

  return {
    exists: existsSync(canonicalPlanPath),
    path: canonicalPlanPath,
  };
}

export function syncTaskPlanFromFile(taskId: string): { synced: boolean } | null {
  const task = findTaskById(taskId);
  if (!task) return null;

  const project = findProjectByTaskId(taskId);
  if (!project) return null;

  const canonicalPlanPath = getCanonicalPlanPath({
    projectRoot: project.rootPath,
    isFix: task.isFix,
  });
  if (!existsSync(canonicalPlanPath)) {
    return { synced: false };
  }

  const filePlan = readFileSync(canonicalPlanPath, "utf8");
  const normalizedPlan = filePlan.trim().length > 0 ? filePlan : null;

  persistTaskPlanForTask({
    taskId,
    planText: normalizedPlan,
    projectRoot: project.rootPath,
    isFix: task.isFix,
    updatedAt: new Date().toISOString(),
  });

  return { synced: true };
}

export {
  toTaskResponse,
  toCommentResponse,
  findTaskById,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  listComments,
  type TaskRow,
  type CommentRow,
};

export function createComment(input: {
  taskId: string;
  message: string;
  attachments?: unknown[];
}): CommentRow | undefined {
  return createTaskComment({
    taskId: input.taskId,
    author: "human",
    message: input.message,
    attachments: input.attachments,
  });
}
