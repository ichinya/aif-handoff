import type { RuntimeModelListInput } from "../../../types.js";
import type { JsonRpcNotificationEnvelope } from "../appServer/protocol.js";
import type { CodexAppServerLogger, CodexAppServerProcessContext } from "../appServer/process.js";

export type CodexModelDiscoveryLogger = CodexAppServerLogger;

export interface JsonRpcClient {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  notify?(method: string, params?: unknown): Promise<void>;
  close(reason?: string): void;
}

export interface JsonRpcClientConnectOptions {
  runtimeId: string;
  profileId?: string | null;
  transport?: string;
  requestTimeoutMs?: number;
  logger?: CodexModelDiscoveryLogger;
  onNotification?: (notification: JsonRpcNotificationEnvelope) => void;
}

export interface CodexModelDiscoveryStartupDeps {
  spawnCodexAppServer: (input: RuntimeModelListInput) => CodexAppServerProcessContext;
  connectJsonRpcClient: (
    launch: CodexAppServerProcessContext,
    options: JsonRpcClientConnectOptions,
  ) => Promise<JsonRpcClient>;
  terminateProcess: (context: CodexAppServerProcessContext) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
}
