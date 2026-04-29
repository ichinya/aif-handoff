import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const generatorScript = fileURLToPath(
  new URL("../../scripts/generate-codex-app-server-protocol.mjs", import.meta.url),
);

describe("codex app-server protocol generator", () => {
  it("uses CODEX_CLI_PATH when launching Codex", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "aif-codex-cli-path-"));
    const missingExecutable = path.join(tempDir, "missing codex executable.cmd");

    try {
      const result = spawnSync(process.execPath, [generatorScript, "--check"], {
        env: {
          ...process.env,
          CODEX_CLI_PATH: missingExecutable,
        },
        encoding: "utf8",
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Codex CLI executable");
      expect(result.stderr).toContain(missingExecutable);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});
