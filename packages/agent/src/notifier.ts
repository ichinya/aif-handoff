import { logger } from "@aif/shared";

const log = logger("agent-notifier");

type BroadcastType = "task:updated" | "task:moved";

export async function notifyTaskBroadcast(
  taskId: string,
  type: BroadcastType = "task:updated",
): Promise<void> {
  const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
  const url = `${baseUrl}/tasks/${taskId}/broadcast`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });

    if (!res.ok) {
      log.debug(
        { taskId, type, status: res.status },
        "Task broadcast request returned non-OK status",
      );
    }
  } catch (err) {
    // Broadcast is best-effort. Agent processing must not fail because API is unavailable.
    log.debug({ taskId, type, err }, "Task broadcast request failed");
  }
}
