interface SpawnCallShape {
  mock: {
    calls: unknown[][];
  };
}

export function splitCommandLine(commandLine: string): string[] {
  const parts = commandLine.match(/"([^"\\]|\\.)*"|[^\s]+/g) ?? [];
  return parts.map((part) => {
    if (part.startsWith('"') && part.endsWith('"')) {
      return part.slice(1, -1).replace(/\\"/g, '"');
    }
    return part;
  });
}

export function getCliSpawnInvocation(spawnCall: SpawnCallShape): {
  cliPath: string;
  cliArgs: string[];
  spawnOptions: Record<string, unknown>;
} {
  const [spawnPath, spawnArgs, spawnOptions] = spawnCall.mock.calls[0] as [
    string,
    string[],
    Record<string, unknown>,
  ];
  if (spawnPath.toLowerCase().endsWith("cmd.exe")) {
    const commandLine = spawnArgs[2] ?? "";
    const [cliPath, ...cliArgs] = splitCommandLine(commandLine);
    return {
      cliPath: cliPath ?? "",
      cliArgs,
      spawnOptions,
    };
  }
  return {
    cliPath: spawnPath,
    cliArgs: spawnArgs,
    spawnOptions,
  };
}
