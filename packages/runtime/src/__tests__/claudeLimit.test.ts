import { describe, expect, it } from "vitest";
import { normalizeClaudeLimitSnapshot } from "../adapters/claude/limit.js";
import {
  RuntimeLimitPrecision,
  RuntimeLimitScope,
  RuntimeLimitSource,
  RuntimeLimitStatus,
} from "../types.js";

describe("normalizeClaudeLimitSnapshot", () => {
  it("returns null when Claude emits no meaningful limit signal", () => {
    expect(
      normalizeClaudeLimitSnapshot({
        info: {},
        runtimeId: "claude",
        providerId: "anthropic",
        profileId: "profile-1",
        checkedAt: "2026-04-17T00:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("normalizes blocked overage signals with utilization ratios", () => {
    const snapshot = normalizeClaudeLimitSnapshot({
      info: {
        status: "allowed_warning",
        overageStatus: "rejected",
        overageResetsAt: 1_800_000_000,
        rateLimitType: "overage",
        utilization: 0.82,
        isUsingOverage: true,
        surpassedThreshold: 0.9,
        overageDisabledReason: "billing_hold",
      },
      runtimeId: "claude",
      providerId: "anthropic",
      profileId: "profile-1",
      checkedAt: "2026-04-17T00:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      source: RuntimeLimitSource.SDK_EVENT,
      status: RuntimeLimitStatus.BLOCKED,
      precision: RuntimeLimitPrecision.HEURISTIC,
      primaryScope: RuntimeLimitScope.SPEND,
      checkedAt: "2026-04-17T00:00:00.000Z",
      resetAt: new Date(1_800_000_000 * 1000).toISOString(),
      providerMeta: {
        rateLimitType: "overage",
        status: "allowed_warning",
        overageStatus: "rejected",
        isUsingOverage: true,
        surpassedThreshold: 0.9,
        overageDisabledReason: "billing_hold",
      },
    });
    expect(snapshot?.windows[0]).toMatchObject({
      scope: RuntimeLimitScope.SPEND,
      name: "overage",
      percentUsed: 82,
      percentRemaining: 18,
      resetAt: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it("treats overage usage as a warning and preserves millisecond reset timestamps", () => {
    const snapshot = normalizeClaudeLimitSnapshot({
      info: {
        isUsingOverage: true,
        resetsAt: 1_800_000_000_000,
        rateLimitType: "five_hour",
        utilization: 55,
      },
      runtimeId: "claude",
      providerId: "anthropic",
      profileId: null,
      checkedAt: "2026-04-17T00:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      status: RuntimeLimitStatus.WARNING,
      primaryScope: RuntimeLimitScope.TIME,
      profileId: null,
      resetAt: new Date(1_800_000_000_000).toISOString(),
    });
    expect(snapshot?.windows[0]).toMatchObject({
      scope: RuntimeLimitScope.TIME,
      name: "five_hour",
      percentUsed: 55,
      percentRemaining: 45,
      resetAt: new Date(1_800_000_000_000).toISOString(),
    });
  });

  it("keeps unknown but structured Claude limit metadata as heuristic OTHER-scope state", () => {
    const snapshot = normalizeClaudeLimitSnapshot({
      info: {
        rateLimitType: "mystery_window",
        resetsAt: 1_800_100_000,
      },
      runtimeId: "claude",
      providerId: "anthropic",
      checkedAt: "2026-04-17T00:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      status: RuntimeLimitStatus.UNKNOWN,
      primaryScope: RuntimeLimitScope.OTHER,
      resetAt: new Date(1_800_100_000 * 1000).toISOString(),
    });
    expect(snapshot?.windows[0]).toMatchObject({
      scope: RuntimeLimitScope.OTHER,
      name: "mystery_window",
    });
  });

  it("drops invalid Claude reset hints instead of throwing", () => {
    const snapshot = normalizeClaudeLimitSnapshot({
      info: {
        status: "rejected",
        rateLimitType: "five_hour",
        resetsAt: Number.MAX_SAFE_INTEGER,
      },
      runtimeId: "claude",
      providerId: "anthropic",
      checkedAt: "2026-04-17T00:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      status: RuntimeLimitStatus.BLOCKED,
      primaryScope: RuntimeLimitScope.TIME,
      resetAt: null,
    });
    expect(snapshot?.windows[0]).toMatchObject({
      scope: RuntimeLimitScope.TIME,
      name: "five_hour",
      resetAt: null,
    });
  });
});
