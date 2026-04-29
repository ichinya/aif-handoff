import { JsonlRpcClient } from "../appServer/jsonlRpcClient.js";
import type { CodexAppServerProcessContext } from "../appServer/process.js";
import type { JsonRpcClient, JsonRpcClientConnectOptions } from "./types.js";

export async function connectJsonRpcClient(
  launch: CodexAppServerProcessContext,
  options: JsonRpcClientConnectOptions,
): Promise<JsonRpcClient> {
  if (launch.process.exitCode != null) {
    const details = launch.stderrTail.join("").trim();
    throw new Error(
      details
        ? `Codex app-server exited early with code ${launch.process.exitCode}: ${details}`
        : `Codex app-server exited early with code ${launch.process.exitCode}`,
    );
  }

  return new JsonlRpcClient(launch.process, {
    runtimeId: options.runtimeId,
    profileId: options.profileId ?? null,
    transport: options.transport,
    requestTimeoutMs: options.requestTimeoutMs,
    logger: options.logger,
    onNotification: options.onNotification,
  });
}

export async function sleep(ms: number): Promise<void> {
  return await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
