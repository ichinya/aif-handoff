import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notifyTaskBroadcast } from "../notifier.js";

describe("notifyTaskBroadcast", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("PORT", "3999");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("sends broadcast request with provided type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as any;

    await notifyTaskBroadcast("task-1", "task:moved");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3999/tasks/task-1/broadcast",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("uses default event type when omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as any;

    await notifyTaskBroadcast("task-2");

    const options = fetchMock.mock.calls[0][1];
    expect(typeof options?.body).toBe("string");
    expect(options?.body).toContain("task:updated");
  });

  it("does not throw on failed fetch", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchMock as any;

    await expect(notifyTaskBroadcast("task-3", "task:updated")).resolves.toBeUndefined();
  });
});
