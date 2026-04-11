import { spawn } from "node:child_process";

// Shared spawn + signal-forwarding helper for local dev runners.
// Used by scripts/dev.mjs and packages/mcp/scripts/dev-http.mjs.
export function spawnDev({ command, args, cwd, env = process.env, label = "dev" }) {
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], {
          cwd,
          stdio: "inherit",
          env,
        })
      : spawn(command, args, {
          cwd,
          stdio: "inherit",
          env,
        });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }

  child.on("error", (error) => {
    console.error(`[${label}] Failed to start`, error);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  return child;
}
