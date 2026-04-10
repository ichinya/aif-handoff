const MIN_POLL_INTERVAL_MS = 10_000;

export interface PollScheduler {
  intervalMs: number;
  stop(): void;
}

export function normalizePollIntervalMs(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return MIN_POLL_INTERVAL_MS;
  }

  return Math.max(Math.floor(intervalMs), MIN_POLL_INTERVAL_MS);
}

export function startPollScheduler(
  callback: () => void | Promise<void>,
  intervalMs: number,
): PollScheduler {
  const normalizedIntervalMs = normalizePollIntervalMs(intervalMs);
  const handle = setInterval(() => {
    void callback();
  }, normalizedIntervalMs);

  return {
    intervalMs: normalizedIntervalMs,
    stop() {
      clearInterval(handle);
    },
  };
}
