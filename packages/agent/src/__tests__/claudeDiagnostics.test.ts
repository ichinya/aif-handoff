import { describe, it, expect } from "vitest";
import { createClaudeStderrCollector, explainClaudeFailure } from "../claudeDiagnostics.js";

describe("claudeDiagnostics", () => {
  it("collects stderr tail lines", () => {
    const collector = createClaudeStderrCollector(2);
    collector.onStderr("line1\nline2\n");
    collector.onStderr("line3\n");

    expect(collector.getTail()).toBe("line2 | line3");
  });

  it("classifies login failures", () => {
    const err = new Error("Claude Code process exited with code 1");
    const reason = explainClaudeFailure(err, "Not logged in · Please run /login");
    expect(reason).toContain("Claude not logged in");
  });

  it("classifies usage limit failures", () => {
    const err = new Error("Claude Code process exited with code 1");
    const reason = explainClaudeFailure(err, "Rate limit reached for this account");
    expect(reason).toContain("Claude usage limit reached");
  });

  it("classifies stream interruption failures", () => {
    const err = new Error("Implementer finished without dispatching implement-worker for parallel plan layers");
    const reason = explainClaudeFailure(err, "Error in hook callback: Stream closed");
    expect(reason).toContain("Claude stream interrupted during execution");
  });
});
