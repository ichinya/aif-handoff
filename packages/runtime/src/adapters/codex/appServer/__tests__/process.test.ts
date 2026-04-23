import { describe, expect, it } from "vitest";
import { buildWindowsAppServerCommandLine } from "../process.js";

describe("codex app-server process helpers", () => {
  it("builds a Windows command line for safe Codex shim paths", () => {
    expect(buildWindowsAppServerCommandLine("codex", ["app-server"])).toBe("codex app-server");
    expect(
      buildWindowsAppServerCommandLine("C:\\Program Files\\Codex\\codex.cmd", ["app-server"]),
    ).toBe('"C:\\Program Files\\Codex\\codex.cmd" app-server');
  });

  it("rejects Windows shell metacharacters in configured Codex command paths", () => {
    expect(() => buildWindowsAppServerCommandLine("codex&calc", ["app-server"])).toThrow(
      "Unsafe Codex app-server command argument contains Windows shell metacharacters",
    );
    expect(() => buildWindowsAppServerCommandLine("codex", ["app-server & calc"])).toThrow(
      "Unsafe Codex app-server command argument contains Windows shell metacharacters",
    );
  });
});
