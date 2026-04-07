import { describe, expect, it } from "vitest";
import { CodexRuntimeAdapterError, classifyCodexRuntimeError } from "../adapters/codex/errors.js";

describe("codex error classification", () => {
  it("returns existing CodexRuntimeAdapterError without re-wrapping", () => {
    const original = new CodexRuntimeAdapterError(
      "OpenAI API HTTP 500: Internal server error",
      "CODEX_RUNTIME_ERROR",
      "unknown",
    );

    const classified = classifyCodexRuntimeError(original);
    expect(classified).toBe(original);
  });

  it("does not classify OpenAI 500 websocket failures as auth", () => {
    const classified = classifyCodexRuntimeError(
      "failed to connect to websocket: HTTP error: 500 Internal Server Error, url: wss://api.openai.com/v1/responses",
    );
    expect(classified.adapterCode).toBe("CODEX_RUNTIME_ERROR");
    expect(classified.category).toBe("unknown");
  });

  it("classifies explicit 401 failures as auth", () => {
    const classified = classifyCodexRuntimeError("OpenAI API HTTP 401: invalid api key");
    expect(classified.adapterCode).toBe("CODEX_AUTH_ERROR");
    expect(classified.category).toBe("auth");
  });
});
