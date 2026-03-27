import { z } from "zod";
import { logger } from "./logger.js";

const log = logger("env");
const BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const BOOLEAN_FALSE_VALUES = new Set(["0", "false", "no", "off"]);

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  PORT: z.coerce.number().default(3001),
  POLL_INTERVAL_MS: z.coerce.number().default(30000),
  AGENT_STAGE_STALE_TIMEOUT_MS: z.coerce.number().default(20 * 60 * 1000),
  AGENT_STAGE_STALE_MAX_RETRY: z.coerce.number().default(3),
  AGENT_STAGE_RUN_TIMEOUT_MS: z.coerce.number().default(15 * 60 * 1000),
  DATABASE_URL: z.string().default("./data/aif.sqlite"),
  AGENT_QUERY_AUDIT_ENABLED: z.preprocess((value) => {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (BOOLEAN_TRUE_VALUES.has(normalized)) return true;
      if (BOOLEAN_FALSE_VALUES.has(normalized)) return false;
    }
    return value;
  }, z.boolean()).default(true),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("debug"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.flatten().fieldErrors;
    log.fatal({ errors: formatted }, "Environment validation failed");
    throw new Error(
      `Environment validation failed: ${JSON.stringify(formatted)}`
    );
  }

  _env = result.data;
  log.debug({ port: _env.PORT, dbUrl: _env.DATABASE_URL }, "Environment loaded");
  return _env;
}

/** Validate env without caching — useful for testing */
export function validateEnv(
  env: Record<string, string | undefined> = process.env
): Env {
  return envSchema.parse(env);
}
