import { logger, getEnv } from "@aif/shared";

const log = logger("mcp:env");

export interface McpEnv {
  /** API server URL for WebSocket broadcast (from shared env) */
  apiUrl: string;
  /** Transport mode: "stdio" (default) or "http" (for Docker / remote) */
  transport: "stdio" | "http";
  /** HTTP port when transport is "http" */
  httpPort: number;
  /** Rate limit: requests per minute for read tools */
  rateLimitReadRpm: number;
  /** Rate limit: requests per minute for write tools */
  rateLimitWriteRpm: number;
  /** Rate limit: burst size for read tools */
  rateLimitReadBurst: number;
  /** Rate limit: burst size for write tools */
  rateLimitWriteBurst: number;
}

function resolveMcpPort(value: string | undefined): number {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 3100;
  }

  const port = Number(trimmed);
  if (Number.isInteger(port) && port > 0 && port <= 65_535) {
    return port;
  }

  throw new Error(`Invalid MCP_PORT: ${trimmed}. Must be an integer between 1 and 65535.`);
}

/**
 * Load MCP-specific environment config.
 * DB connection uses the shared getDb() from @aif/shared/server (same as api/agent).
 * API_BASE_URL comes from the shared env.
 */
export function loadMcpEnv(): McpEnv {
  const sharedEnv = getEnv();

  const transport = (process.env.MCP_TRANSPORT || "stdio") as "stdio" | "http";
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`Invalid MCP_TRANSPORT: ${transport}. Must be "stdio" or "http".`);
  }

  const env: McpEnv = {
    apiUrl: sharedEnv.API_BASE_URL,
    transport,
    httpPort: resolveMcpPort(process.env.MCP_PORT),
    rateLimitReadRpm: parseInt(process.env.MCP_RATE_LIMIT_READ_RPM || "120", 10),
    rateLimitWriteRpm: parseInt(process.env.MCP_RATE_LIMIT_WRITE_RPM || "30", 10),
    rateLimitReadBurst: parseInt(process.env.MCP_RATE_LIMIT_READ_BURST || "10", 10),
    rateLimitWriteBurst: parseInt(process.env.MCP_RATE_LIMIT_WRITE_BURST || "5", 10),
  };

  log.info(
    {
      transport: env.transport,
      httpPort: env.httpPort,
    },
    "MCP environment loaded",
  );

  return env;
}
