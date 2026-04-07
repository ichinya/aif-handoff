import { describe, expect, it } from "vitest";
import { classifyOpenCodeRuntimeError } from "../adapters/opencode/errors.js";

describe("OpenCode error classification", () => {
  it("classifies auth errors", () => {
    const error = classifyOpenCodeRuntimeError(new Error("401 unauthorized"));
    expect(error.adapterCode).toBe("OPENCODE_AUTH_ERROR");
    expect(error.category).toBe("auth");
  });

  it("classifies rate limit errors", () => {
    const error = classifyOpenCodeRuntimeError(new Error("429 rate limit exceeded"));
    expect(error.adapterCode).toBe("OPENCODE_RATE_LIMIT");
    expect(error.category).toBe("rate_limit");
  });

  it("classifies timeout errors", () => {
    const error = classifyOpenCodeRuntimeError(new Error("request timeout"));
    expect(error.adapterCode).toBe("OPENCODE_TIMEOUT");
    expect(error.category).toBe("timeout");
  });

  it("classifies network errors", () => {
    const error = classifyOpenCodeRuntimeError(new Error("connection refused"));
    expect(error.adapterCode).toBe("OPENCODE_TRANSPORT_ERROR");
  });

  it("classifies session errors", () => {
    const error = classifyOpenCodeRuntimeError(new Error("session not found"));
    expect(error.adapterCode).toBe("OPENCODE_SESSION_ERROR");
  });

  it("classifies provider/model errors", () => {
    const error = classifyOpenCodeRuntimeError(
      new Error("ProviderModelNotFoundError: provider not found"),
    );
    expect(error.adapterCode).toBe("OPENCODE_MODEL_ERROR");
    expect(error.category).toBe("unknown");
  });

  it("falls back to generic runtime error", () => {
    const error = classifyOpenCodeRuntimeError(new Error("unexpected"));
    expect(error.adapterCode).toBe("OPENCODE_RUNTIME_ERROR");
    expect(error.category).toBe("unknown");
  });
});
