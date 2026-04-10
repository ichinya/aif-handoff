import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePollIntervalMs, startPollScheduler } from "../pollScheduler.js";

describe("pollScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps millisecond intervals above the minimum unchanged", () => {
    expect(normalizePollIntervalMs(600_000)).toBe(600_000);
  });

  it("clamps invalid or too-small intervals to the minimum", () => {
    expect(normalizePollIntervalMs(0)).toBe(10_000);
    expect(normalizePollIntervalMs(-1)).toBe(10_000);
    expect(normalizePollIntervalMs(9_999)).toBe(10_000);
  });

  it("schedules callbacks using the normalized millisecond interval", async () => {
    const callback = vi.fn();
    const scheduler = startPollScheduler(callback, 600_000);

    expect(scheduler.intervalMs).toBe(600_000);

    await vi.advanceTimersByTimeAsync(599_999);
    expect(callback).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
