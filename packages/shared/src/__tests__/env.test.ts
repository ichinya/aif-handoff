import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateEnv } from "../env.js";

describe("env validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should pass with valid config", () => {
    const result = validateEnv({
      ANTHROPIC_API_KEY: "sk-ant-test-key",
      PORT: "3001",
      POLL_INTERVAL_MS: "30000",
      DATABASE_URL: "./data/test.sqlite",
      AGENT_QUERY_AUDIT_ENABLED: "false",
      LOG_LEVEL: "debug",
    });

    expect(result.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");
    expect(result.PORT).toBe(3001);
    expect(result.POLL_INTERVAL_MS).toBe(30000);
    expect(result.DATABASE_URL).toBe("./data/test.sqlite");
    expect(result.AGENT_QUERY_AUDIT_ENABLED).toBe(false);
    expect(result.LOG_LEVEL).toBe("debug");
  });

  it("should apply defaults for optional fields", () => {
    const result = validateEnv({});

    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.PORT).toBe(3001);
    expect(result.POLL_INTERVAL_MS).toBe(30000);
    expect(result.AGENT_STAGE_STALE_TIMEOUT_MS).toBe(20 * 60 * 1000);
    expect(result.AGENT_STAGE_STALE_MAX_RETRY).toBe(3);
    expect(result.AGENT_STAGE_RUN_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(result.DATABASE_URL).toBe("./data/aif.sqlite");
    expect(result.AGENT_QUERY_AUDIT_ENABLED).toBe(true);
    expect(result.LOG_LEVEL).toBe("debug");
  });

  it("should accept missing ANTHROPIC_API_KEY (uses ~/.claude/ auth)", () => {
    const result = validateEnv({});
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("should coerce PORT to number", () => {
    const result = validateEnv({
      ANTHROPIC_API_KEY: "sk-ant-test-key",
      PORT: "8080",
    });
    expect(result.PORT).toBe(8080);
  });

  it("should reject invalid LOG_LEVEL", () => {
    expect(() =>
      validateEnv({
        ANTHROPIC_API_KEY: "sk-ant-test-key",
        LOG_LEVEL: "invalid",
      })
    ).toThrow();
  });

  it("getEnv should cache parsed environment", async () => {
    vi.stubEnv("PORT", "3200");
    vi.stubEnv("DATABASE_URL", "./data/cached.sqlite");
    const { getEnv } = await import("../env.js");

    const first = getEnv();
    vi.stubEnv("PORT", "9999");
    const second = getEnv();

    expect(first).toBe(second);
    expect(second.PORT).toBe(3200);
    vi.unstubAllEnvs();
  });

  it("getEnv should throw on invalid environment", async () => {
    vi.stubEnv("PORT", "not-a-number");
    const { getEnv } = await import("../env.js");
    expect(() => getEnv()).toThrow("Environment validation failed");
    vi.unstubAllEnvs();
  });
});
