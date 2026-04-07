import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const mkdirMock = vi.fn();
const existsSyncMock = vi.fn();
const homedirMock = vi.fn(() => "C:\\Users\\Daniil");

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
}));

vi.mock("node:os", () => ({
  homedir: () => homedirMock(),
}));

const { getCodexMcpStatus, installCodexMcpServer } = await import("../adapters/codex/mcp.js");

describe("Codex MCP config", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    writeFileMock.mockReset();
    mkdirMock.mockReset();
    existsSyncMock.mockReset();
    readFileMock.mockRejectedValue(new Error("missing"));
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    existsSyncMock.mockReturnValue(true);
  });

  it("escapes Windows paths in args when writing TOML", async () => {
    await installCodexMcpServer({
      serverName: "handoff",
      command: "npx",
      args: [
        "tsx",
        "E:\\Users\\Daniil\\PhpstormProjects\\aif-handoff\\packages\\mcp\\src\\index.ts",
      ],
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, content] = writeFileMock.mock.calls[0] as [string, string];
    expect(content).toContain(
      'args = [ "tsx", "E:\\\\Users\\\\Daniil\\\\PhpstormProjects\\\\aif-handoff\\\\packages\\\\mcp\\\\src\\\\index.ts" ]',
    );
  });

  it("reads escaped Windows paths back from TOML", async () => {
    readFileMock.mockResolvedValue(`[mcp_servers.handoff]
command = "npx"
args = [ "tsx", "E:\\\\Users\\\\Daniil\\\\PhpstormProjects\\\\aif-handoff\\\\packages\\\\mcp\\\\src\\\\index.ts" ]
`);

    const status = await getCodexMcpStatus({ serverName: "handoff" });

    expect(status.installed).toBe(true);
    expect(status.config).toEqual({
      command: "npx",
      args: [
        "tsx",
        "E:\\Users\\Daniil\\PhpstormProjects\\aif-handoff\\packages\\mcp\\src\\index.ts",
      ],
    });
  });
});
