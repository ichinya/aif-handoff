import pino from "pino";

const level = process.env.LOG_LEVEL ?? "debug";

const rootLogger = pino({
  level,
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
});

/** Create a child logger with a component name */
export function logger(component: string): pino.Logger {
  return rootLogger.child({ component });
}

export { rootLogger };
