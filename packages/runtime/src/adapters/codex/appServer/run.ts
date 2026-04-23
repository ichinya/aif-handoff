import type { RuntimeRunInput, RuntimeRunResult } from "../../../types.js";
import {
  isRetriableTimeoutError,
  makeProcessRunTimeoutError,
  makeProcessStartTimeoutError,
  resolveRetryDelay,
  sleepMs,
  withProcessTimeouts,
} from "../../../timeouts.js";
import { RuntimeTransport } from "../../../types.js";
import { CodexAppServerClient } from "./client.js";
import { CodexAppServerEventMapper, type CodexAppServerEventMapperLogger } from "./eventMapper.js";
import { classifyCodexAppServerError } from "./errors.js";
import { JsonlRpcClient } from "./jsonlRpcClient.js";
import type { CodexAppServerRequestMap } from "./protocol.js";
import { spawnCodexAppServerProcess, terminateCodexAppServerProcess } from "./process.js";
import type { JsonValue } from "./generated/serde_json/JsonValue.js";
import type { ReasoningEffort } from "./generated/ReasoningEffort.js";
import type { AskForApproval } from "./generated/v2/AskForApproval.js";
import type { SandboxPolicy } from "./generated/v2/SandboxPolicy.js";
import type { SandboxMode } from "./generated/v2/SandboxMode.js";
import {
  normalizeCodexApprovalPolicy,
  normalizeCodexSandboxMode,
  warnOnInvalidCodexPermissionOverride,
} from "../permissions.js";

export type CodexAppServerRunLogger = CodexAppServerEventMapperLogger;

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;

const CODEX_EFFORT_LEVELS = new Set<ReasoningEffort>(["minimal", "low", "medium", "high", "xhigh"]);

type CodexAppServerJsonObject = { [key: string]: JsonValue };

interface DeferredCompletion<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  isSettled: () => boolean;
}

export async function runCodexAppServer(
  input: RuntimeRunInput,
  logger?: CodexAppServerRunLogger,
): Promise<RuntimeRunResult> {
  logger?.info?.(
    {
      runtimeId: input.runtimeId,
      profileId: input.profileId ?? null,
      transport: "app-server",
      resume: Boolean(input.resume && input.sessionId),
      model: input.model ?? null,
      startTimeoutMs: input.execution?.startTimeoutMs ?? null,
      runTimeoutMs: input.execution?.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    },
    "INFO [runtime:codex] Starting Codex app-server run",
  );

  try {
    const result = await runCodexAppServerAttempt(input, logger);
    logger?.info?.(
      {
        runtimeId: input.runtimeId,
        profileId: input.profileId ?? null,
        transport: "app-server",
        sessionId: result.sessionId ?? null,
        outputLength: result.outputText?.length ?? 0,
        eventCount: result.events?.length ?? 0,
        hasUsage: Boolean(result.usage),
      },
      "INFO [runtime:codex] Codex app-server run completed",
    );
    return result;
  } catch (error) {
    if (isRetriableTimeoutError(error)) {
      const retryDelayMs = resolveRetryDelay(input.execution ?? {});
      logger?.warn?.(
        {
          runtimeId: input.runtimeId,
          profileId: input.profileId ?? null,
          transport: "app-server",
          retryDelayMs,
        },
        "WARN [runtime:codex] Codex app-server start timeout, retrying once after delay",
      );
      await sleepMs(retryDelayMs);
      return await runCodexAppServerAttempt(input, logger);
    }
    throw classifyCodexAppServerError(error);
  }
}

async function runCodexAppServerAttempt(
  input: RuntimeRunInput,
  logger?: CodexAppServerRunLogger,
): Promise<RuntimeRunResult> {
  const completion = createDeferredCompletion<void>();
  completion.promise.catch(() => undefined);
  const launch = spawnCodexAppServerProcess({
    input: toLaunchInput(input),
    logger,
  });
  const timeouts = withProcessTimeouts(
    launch.process,
    {
      startTimeoutMs: input.execution?.startTimeoutMs,
      runTimeoutMs: input.execution?.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    },
    logger,
  );

  let threadId: string | null = null;
  let turnId: string | null = null;
  let interruptRequested = false;
  let interruptInFlight: Promise<void> | null = null;
  const abortSignal = input.execution?.abortController?.signal;
  let completionFailure: Error | null = null;
  const experimentalApiEnabled = asRecord(input.options).experimentalApi === true;

  const mapper = new CodexAppServerEventMapper({
    input,
    logger,
    onTurnCompleted: () => completion.resolve(),
    onTurnFailed: (error) => {
      completionFailure = error;
      completion.reject(error);
    },
  });

  const rpcClient = new JsonlRpcClient(launch.process, {
    runtimeId: input.runtimeId,
    profileId: input.profileId ?? null,
    transport: RuntimeTransport.APP_SERVER,
    requestTimeoutMs: resolveRequestTimeout(input),
    logger,
    onNotification: (notification) => {
      mapper.handleNotification(notification.method, notification.params);
      threadId = mapper.getThreadId() ?? threadId;
      turnId = mapper.getTurnId() ?? turnId;
    },
    onRequest: (request) => mapper.handleServerRequest(request.method, request.params),
    onProtocolError: (error) => {
      completionFailure = error;
      completion.reject(error);
    },
  });
  const client = new CodexAppServerClient(rpcClient, {
    runtimeId: input.runtimeId,
    profileId: input.profileId ?? null,
    transport: RuntimeTransport.APP_SERVER,
    requestTimeoutMs: resolveRequestTimeout(input),
    logger,
  });
  const sendInterruptIfReady = (): void => {
    if (
      !interruptRequested ||
      !threadId ||
      !turnId ||
      interruptInFlight ||
      completion.isSettled()
    ) {
      return;
    }

    const interruptThreadId = threadId;
    const interruptTurnId = turnId;
    logger?.debug?.(
      {
        runtimeId: input.runtimeId,
        profileId: input.profileId ?? null,
        transport: "app-server",
        threadId: interruptThreadId,
        turnId: interruptTurnId,
      },
      "DEBUG [runtime:codex] Abort requested, sending turn/interrupt",
    );

    interruptInFlight = requestInterrupt(client, interruptThreadId, interruptTurnId, logger)
      .catch((error) => {
        logger?.error?.(
          {
            runtimeId: input.runtimeId,
            profileId: input.profileId ?? null,
            transport: "app-server",
            threadId: interruptThreadId,
            turnId: interruptTurnId,
            error: error instanceof Error ? error.message : String(error),
          },
          "ERROR [runtime:codex] Failed to interrupt app-server turn",
        );
      })
      .finally(() => {
        interruptInFlight = null;
      });
  };
  const abortHandler = (): void => {
    interruptRequested = true;
    sendInterruptIfReady();
  };

  const processExitHandler = (code: number | null, signal: NodeJS.Signals | null) => {
    if (completion.isSettled()) {
      return;
    }
    completion.reject(
      new Error(
        `Codex app-server exited before turn completion (code=${code ?? "null"}, signal=${signal ?? "null"})`,
      ),
    );
  };
  launch.process.once("exit", processExitHandler);

  try {
    await client.initialize({
      clientInfo: {
        name: "aif-runtime-codex-runner",
        title: "AIF Runtime Codex Runner",
        version: "1.0",
      },
      capabilities: {
        experimentalApi: experimentalApiEnabled,
      },
    });

    const permissionSettings = resolveCodexPermissionOverrides(input, logger);
    const composedPrompt = composePrompt(input);
    const threadMetadata = buildThreadMetadata(input, permissionSettings);
    logger?.debug?.(
      {
        runtimeId: input.runtimeId,
        profileId: input.profileId ?? null,
        transport: "app-server",
        approvalPolicy: permissionSettings.approvalPolicy,
        sandboxMode: permissionSettings.sandboxMode,
        hasReasoningEffort: Boolean(permissionSettings.modelReasoningEffort),
      },
      "DEBUG [runtime:codex] Resolved app-server approval and sandbox settings",
    );

    logger?.debug?.(
      {
        runtimeId: input.runtimeId,
        profileId: input.profileId ?? null,
        transport: "app-server",
        experimentalApi: experimentalApiEnabled,
        sendsExperimentalHistoryFields: experimentalApiEnabled,
      },
      "DEBUG [runtime:codex] [FIX:app-server-experimental-history] Prepared thread payload capability gates",
    );

    if (input.resume && input.sessionId) {
      const resumeThreadId = parseCodexThreadId(input.sessionId);
      const resumeParams = {
        threadId: resumeThreadId,
        model: input.model ?? null,
        cwd: input.cwd ?? input.projectRoot ?? null,
        approvalPolicy: permissionSettings.approvalPolicy,
        sandbox: permissionSettings.sandboxMode,
        config: threadMetadata,
        ...(experimentalApiEnabled ? { persistExtendedHistory: true } : {}),
      } as CodexAppServerRequestMap["thread/resume"]["params"];
      const resumed = await client.resumeThread(resumeParams);
      threadId = resumed.thread.id;
      mapper.handleNotification("thread/resumed", { threadId });
      logger?.info?.(
        {
          runtimeId: input.runtimeId,
          profileId: input.profileId ?? null,
          transport: "app-server",
          threadId,
        },
        "INFO [runtime:codex] Codex app-server resume completed",
      );
    } else {
      const startParams = {
        model: input.model ?? undefined,
        cwd: input.cwd ?? input.projectRoot ?? null,
        approvalPolicy: permissionSettings.approvalPolicy,
        sandbox: permissionSettings.sandboxMode,
        config: threadMetadata,
        ...(experimentalApiEnabled
          ? {
              experimentalRawEvents: false,
              persistExtendedHistory: true,
            }
          : {}),
      } as CodexAppServerRequestMap["thread/start"]["params"];
      const started = await client.startThread(startParams);
      threadId = started.thread.id;
      mapper.handleNotification("thread/started", { threadId });
      logger?.info?.(
        {
          runtimeId: input.runtimeId,
          profileId: input.profileId ?? null,
          transport: "app-server",
          threadId,
        },
        "INFO [runtime:codex] Codex app-server run started",
      );
    }

    if (!threadId) {
      throw new Error("Codex app-server did not return a thread id");
    }

    if (abortSignal) {
      if (abortSignal.aborted) {
        abortHandler();
      } else {
        abortSignal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    const turnStarted = await client.startTurn({
      threadId,
      input: [
        {
          type: "text",
          text: composedPrompt,
          text_elements: [],
        },
      ],
      cwd: input.cwd ?? input.projectRoot ?? null,
      approvalPolicy: permissionSettings.approvalPolicy,
      sandboxPolicy: buildSandboxPolicy(permissionSettings.sandboxMode, input),
      model: input.model ?? null,
      effort: permissionSettings.modelReasoningEffort,
      outputSchema: (input.execution?.outputSchema as JsonValue | undefined) ?? null,
    });
    turnId = turnStarted.turn.id;
    mapper.handleNotification("turn/started", { turnId });
    sendInterruptIfReady();

    await completion.promise;

    if (completionFailure) {
      throw completionFailure;
    }

    const startTimedOut = await timeouts.startTimedOut;
    if (startTimedOut) {
      throw makeProcessStartTimeoutError(input.execution?.startTimeoutMs ?? 0);
    }
    if (timeouts.runTimedOut) {
      throw makeProcessRunTimeoutError(input.execution?.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
    }

    const usage = mapper.getUsage();
    if (!usage) {
      logger?.warn?.(
        {
          runtimeId: input.runtimeId,
          profileId: input.profileId ?? null,
          transport: "app-server",
          threadId,
          turnId,
        },
        "WARN [runtime:codex] App-server turn completed without usage payload",
      );
    }

    return {
      outputText: mapper.getOutputText(),
      sessionId: mapper.getThreadId() ?? threadId,
      events: mapper.getEvents(),
      usage,
      raw: {
        provider: "openai",
        runtime: "codex",
        transport: "app-server",
        codexThreadId: mapper.getThreadId() ?? threadId,
        codexTurnId: mapper.getTurnId() ?? turnId,
        rawUsage: mapper.getRawUsage(),
      },
    };
  } catch (error) {
    const startTimedOut = await timeouts.startTimedOut;
    if (startTimedOut) {
      throw makeProcessStartTimeoutError(input.execution?.startTimeoutMs ?? 0);
    }
    if (timeouts.runTimedOut) {
      if (interruptRequested) {
        logger?.warn?.(
          {
            runtimeId: input.runtimeId,
            profileId: input.profileId ?? null,
            transport: "app-server",
            threadId,
            turnId,
          },
          "WARN [runtime:codex] Interrupted turn did not stop before timeout; forcing close",
        );
      }
      throw makeProcessRunTimeoutError(input.execution?.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
    }
    throw error;
  } finally {
    abortSignal?.removeEventListener("abort", abortHandler);
    launch.process.off("exit", processExitHandler);
    timeouts.cleanup();
    client.close("run finished");
    await terminateCodexAppServerProcess(launch, logger);
  }
}

function resolveRequestTimeout(input: RuntimeRunInput): number {
  const options = asRecord(input.options);
  const optionTimeout = readNumber(options.appServerRequestTimeoutMs);
  return optionTimeout && optionTimeout > 0
    ? Math.floor(optionTimeout)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function composePrompt(input: RuntimeRunInput): string {
  const append = input.execution?.systemPromptAppend?.trim();
  return append ? `${append}\n\n${input.prompt}` : input.prompt;
}

function buildThreadMetadata(
  input: RuntimeRunInput,
  permissions: {
    approvalPolicy: AskForApproval;
    sandboxMode: SandboxMode;
    modelReasoningEffort: ReasoningEffort | null;
  },
): CodexAppServerJsonObject {
  const metadata: CodexAppServerJsonObject = {
    runtimeId: input.runtimeId,
    profileId: input.profileId ?? null,
    workflowKind: input.workflowKind ?? null,
    projectRoot: input.projectRoot ?? null,
    cwd: input.cwd ?? null,
    approvalPolicy: permissions.approvalPolicy,
    sandboxMode: permissions.sandboxMode,
  };
  if (permissions.modelReasoningEffort) {
    metadata.modelReasoningEffort = permissions.modelReasoningEffort;
  }
  return metadata;
}

function resolveCodexPermissionOverrides(
  input: RuntimeRunInput,
  logger?: CodexAppServerRunLogger,
): {
  approvalPolicy: AskForApproval;
  sandboxMode: SandboxMode;
  modelReasoningEffort: ReasoningEffort | null;
} {
  const options = asRecord(input.options);
  const rawApproval = readString(options.approvalPolicy);
  const rawSandbox = readString(options.sandboxMode);
  const explicitApproval = normalizeCodexApprovalPolicy(rawApproval);
  const explicitSandbox = normalizeCodexSandboxMode(rawSandbox);
  const bypass = input.execution?.bypassPermissions === true;

  warnOnInvalidCodexPermissionOverride({
    logger,
    runtimeId: input.runtimeId,
    transport: "app-server",
    field: "approvalPolicy",
    rawValue: rawApproval,
    normalizedValue: explicitApproval,
  });
  warnOnInvalidCodexPermissionOverride({
    logger,
    runtimeId: input.runtimeId,
    transport: "app-server",
    field: "sandboxMode",
    rawValue: rawSandbox,
    normalizedValue: explicitSandbox,
  });

  const rawEffort = readString(options.modelReasoningEffort)?.toLowerCase() ?? null;
  const modelReasoningEffort =
    rawEffort && CODEX_EFFORT_LEVELS.has(rawEffort as ReasoningEffort)
      ? (rawEffort as ReasoningEffort)
      : null;

  return {
    approvalPolicy: explicitApproval ?? (bypass ? "never" : "on-request"),
    sandboxMode: explicitSandbox ?? (bypass ? "danger-full-access" : "workspace-write"),
    modelReasoningEffort,
  };
}

async function requestInterrupt(
  client: CodexAppServerClient,
  threadId: string,
  turnId: string,
  logger?: CodexAppServerRunLogger,
): Promise<void> {
  await client.interruptTurn({
    threadId,
    turnId,
  });
  logger?.debug?.(
    {
      transport: "app-server",
      threadId,
      turnId,
    },
    "DEBUG [runtime:codex] Sent turn/interrupt to Codex app-server",
  );
}

function parseCodexThreadId(sessionId: string): string {
  const prefix = "codex-app-server:";
  return sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : sessionId;
}

function buildSandboxPolicy(sandboxMode: string, input: RuntimeRunInput): SandboxPolicy {
  if (sandboxMode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }

  const fullReadAccess = { type: "fullAccess" } as const;
  if (sandboxMode === "read-only") {
    return {
      type: "readOnly",
      access: fullReadAccess,
      networkAccess: false,
    };
  }

  return {
    type: "workspaceWrite",
    writableRoots: [input.cwd ?? input.projectRoot ?? process.cwd()],
    readOnlyAccess: fullReadAccess,
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function toLaunchInput(input: RuntimeRunInput): {
  runtimeId: string;
  profileId: string | null;
  transport: RuntimeTransport;
  options: Record<string, unknown>;
  projectRoot?: string;
  cwd?: string;
  apiKey?: string | null;
  apiKeyEnvVar?: string | null;
  baseUrl?: string | null;
} {
  const options = asRecord(input.options);
  return {
    runtimeId: input.runtimeId,
    profileId: input.profileId ?? null,
    transport: RuntimeTransport.APP_SERVER,
    options,
    projectRoot: input.projectRoot,
    cwd: input.cwd,
    apiKey: readString(options.apiKey),
    apiKeyEnvVar: readString(options.apiKeyEnvVar),
    baseUrl: readString(options.baseUrl),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function createDeferredCompletion<T>(): DeferredCompletion<T> {
  let resolveFn: ((value: T) => void) | null = null;
  let rejectFn: ((error: Error) => void) | null = null;
  let settled = false;

  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    rejectFn = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
  });

  return {
    promise,
    resolve(value: T) {
      resolveFn?.(value);
    },
    reject(error: Error) {
      rejectFn?.(error);
    },
    isSettled() {
      return settled;
    },
  };
}
