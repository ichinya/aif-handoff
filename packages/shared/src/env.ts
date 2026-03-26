import { z } from "zod";
import { logger } from "./logger.js";

const log = logger("env");

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  PORT: z.coerce.number().default(3001),
  POLL_INTERVAL_MS: z.coerce.number().default(30000),
  DATABASE_URL: z.string().default("./data/aif.sqlite"),
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
