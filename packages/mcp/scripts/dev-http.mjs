import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.MCP_PORT || "3100";
console.log(`[mcp] Starting HTTP transport on port ${port}`);

const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", "npx", "tsx", "watch", "src/index.ts"], {
        cwd: packageRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          MCP_TRANSPORT: "http",
          MCP_PORT: port,
        },
      })
    : spawn("npx", ["tsx", "watch", "src/index.ts"], {
        cwd: packageRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          MCP_TRANSPORT: "http",
          MCP_PORT: port,
        },
      });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error("[mcp] Failed to start dev server", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
