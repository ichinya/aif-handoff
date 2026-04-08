import type { ChildProcess } from "node:child_process";

export interface CodexModelDiscoveryLogger {
  debug?(context: Record<string, unknown>, message: string): void;
  info?(context: Record<string, unknown>, message: string): void;
  warn?(context: Record<string, unknown>, message: string): void;
  error?(context: Record<string, unknown>, message: string): void;
}

export interface JsonRpcClient {
  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  close(): Promise<void>;
}

export interface AppServerLaunchContext {
  process: ChildProcess;
  stderr: string[];
}

export interface CodexModelDiscoveryStartupDeps {
  reservePort: () => Promise<number>;
  spawnCodexAppServer: (
    executablePath: string,
    listenUrl: string,
    cwd: string | undefined,
    env: Record<string, string>,
  ) => AppServerLaunchContext;
  connectJsonRpcClient: (
    listenUrl: string,
    launch: AppServerLaunchContext,
    timeoutMs: number,
  ) => Promise<JsonRpcClient>;
  terminateProcess: (process: ChildProcess) => void;
  sleep: (ms: number) => Promise<void>;
}
