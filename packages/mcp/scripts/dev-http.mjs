import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnDev } from "../../../scripts/lib/spawn-dev.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.MCP_PORT || "3100";
console.log(`[mcp] Starting HTTP transport on port ${port}`);

spawnDev({
  command: "npx",
  args: ["tsx", "watch", "src/index.ts"],
  cwd: packageRoot,
  env: {
    ...process.env,
    MCP_TRANSPORT: "http",
    MCP_PORT: port,
  },
  label: "mcp",
});
