import { RuntimeExecutionError, type RuntimeErrorCategory } from "../../errors.js";

const AUTH_PATTERNS = [
  "unauthorized",
  "forbidden",
  "authentication",
  "invalid credentials",
  "invalid password",
  "401",
  "403",
];
const RATE_LIMIT_PATTERNS = ["rate limit", "rate_limit", "too many requests", "429", "quota"];
const TIMEOUT_PATTERNS = ["timed out", "timeout", "etimedout", "aborted"];
const NETWORK_PATTERNS = ["network", "fetch failed", "econnrefused", "connection refused"];
const SESSION_PATTERNS = ["session", "not found", "404"];
const MODEL_PATTERNS = [
  "providermodelnotfounderror",
  "modelnotfounderror",
  "provider not found",
  "model not found",
];

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classify(message: string): { adapterCode: string; category: RuntimeErrorCategory } {
  const lowered = message.toLowerCase();

  if (AUTH_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return { adapterCode: "OPENCODE_AUTH_ERROR", category: "auth" };
  }
  if (RATE_LIMIT_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return { adapterCode: "OPENCODE_RATE_LIMIT", category: "rate_limit" };
  }
  if (TIMEOUT_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return { adapterCode: "OPENCODE_TIMEOUT", category: "timeout" };
  }
  if (NETWORK_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return { adapterCode: "OPENCODE_TRANSPORT_ERROR", category: "unknown" };
  }
  if (MODEL_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return { adapterCode: "OPENCODE_MODEL_ERROR", category: "unknown" };
  }
  if (SESSION_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return { adapterCode: "OPENCODE_SESSION_ERROR", category: "unknown" };
  }

  return { adapterCode: "OPENCODE_RUNTIME_ERROR", category: "unknown" };
}

export class OpenCodeRuntimeAdapterError extends RuntimeExecutionError {
  public readonly adapterCode: string;

  constructor(
    message: string,
    adapterCode: string,
    category: RuntimeErrorCategory,
    cause?: unknown,
  ) {
    super(message, cause, category);
    this.name = "OpenCodeRuntimeAdapterError";
    this.adapterCode = adapterCode;
  }
}

export function classifyOpenCodeRuntimeError(error: unknown): OpenCodeRuntimeAdapterError {
  const message = messageFromUnknown(error);
  const { adapterCode, category } = classify(message);
  return new OpenCodeRuntimeAdapterError(message, adapterCode, category, error);
}
