import type { RuntimeModelListInput } from "../../../types.js";
import {
  buildCodexAppServerEnv,
  buildCodexAppServerEnvWithStats,
  resolveCodexAppServerExecutable,
  spawnCodexAppServerProcess,
  terminateCodexAppServerProcess,
  type CodexAppServerLaunchInput,
  type CodexAppServerProcessContext,
} from "../appServer/process.js";

export function resolveDiscoveryExecutable(input: RuntimeModelListInput): string {
  return resolveCodexAppServerExecutable(toLaunchInput(input));
}

export function buildCodexAppServerDiscoveryEnv(
  input: RuntimeModelListInput,
): Record<string, string> {
  return buildCodexAppServerEnv(toLaunchInput(input));
}

export function buildCodexAppServerDiscoveryEnvWithStats(input: RuntimeModelListInput): {
  env: Record<string, string>;
  forwardedCount: number;
  filteredCount: number;
  blockedCount: number;
  droppedDisallowedPrefixKeys: string[];
} {
  return buildCodexAppServerEnvWithStats(toLaunchInput(input));
}

export function spawnCodexAppServer(input: RuntimeModelListInput): CodexAppServerProcessContext {
  return spawnCodexAppServerProcess({
    input: toLaunchInput(input),
  });
}

export async function terminateProcess(context: CodexAppServerProcessContext): Promise<void> {
  await terminateCodexAppServerProcess(context);
}

function toLaunchInput(input: RuntimeModelListInput): CodexAppServerLaunchInput {
  return {
    runtimeId: input.runtimeId,
    profileId: input.profileId ?? null,
    transport: input.transport,
    projectRoot: input.projectRoot,
    options: input.options,
    apiKey: input.apiKey ?? null,
    apiKeyEnvVar: input.apiKeyEnvVar ?? null,
    baseUrl: input.baseUrl ?? null,
  };
}
