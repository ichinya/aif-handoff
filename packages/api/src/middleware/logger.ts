import type { MiddlewareHandler } from "hono";
import { logger as createLogger } from "@aif/shared";

const log = createLogger("api");

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const { method, url } = c.req.raw;

  log.debug({ method, url }, "Incoming request");

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;

  log.debug({ method, url, status, duration }, "Request completed");
};
