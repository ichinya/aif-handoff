#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, "..");
const generatedDir = path.join(runtimeRoot, "src/adapters/codex/appServer/generated");
const schemaDir = path.join(generatedDir, "schema");
const checkMode = process.argv.includes("--check");

if (checkMode) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "aif-codex-app-server-protocol-"));
  const tempGeneratedDir = path.join(tempRoot, "generated");
  const tempSchemaDir = path.join(tempGeneratedDir, "schema");
  try {
    await generateInto(tempGeneratedDir, tempSchemaDir);
    const diff = diffDirectories(generatedDir, tempGeneratedDir);
    if (diff.length > 0) {
      fail(
        `Generated Codex app-server protocol artifacts are out of sync:\n${diff
          .slice(0, 20)
          .map((entry) => `- ${entry}`)
          .join("\n")}\nRun "npm run -w @aif/runtime codex:app-server:protocol:generate".`,
      );
    }
    console.log("Codex app-server protocol artifacts are in sync.");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  process.exit(0);
}

await generateInto(generatedDir, schemaDir);
console.log("Codex app-server protocol artifacts generated from the installed Codex CLI.");

async function generateInto(typesOut, schemaOut) {
  cleanGeneratedDirectory(typesOut);
  runCodex(["app-server", "generate-ts", "--out", typesOut]);
  runCodex(["app-server", "generate-json-schema", "--out", schemaOut]);
  await formatGeneratedDirectory(typesOut);
}

function cleanGeneratedDirectory(root) {
  if (!existsSync(root)) {
    return;
  }
  for (const entry of readdirSync(root)) {
    if (entry === "README.md") {
      continue;
    }
    rmSync(path.join(root, entry), { recursive: true, force: true });
  }
}

function runCodex(args) {
  const executablePath = resolveCodexExecutable();
  let commandSpec;
  try {
    commandSpec = buildCodexCommand(executablePath, args);
  } catch (error) {
    fail(`Refusing to execute Codex CLI executable "${executablePath}": ${getErrorMessage(error)}`);
  }
  const result = spawnSync(commandSpec.command, commandSpec.commandArgs, {
    cwd: runtimeRoot,
    stdio: "inherit",
  });
  if (result.error) {
    fail(
      `Failed to execute Codex CLI executable "${executablePath}". Install @openai/codex, ensure "codex" is in PATH, or set CODEX_CLI_PATH: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    fail(
      `Codex CLI executable "${executablePath}" exited with status ${result.status ?? "null"} while running: ${formatCodexInvocation(
        executablePath,
        args,
      )}`,
    );
  }
}

function resolveCodexExecutable() {
  const configured = process.env.CODEX_CLI_PATH;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim();
  }
  return "codex";
}

function buildCodexCommand(executablePath, args) {
  if (process.platform !== "win32") {
    return {
      command: executablePath,
      commandArgs: args,
    };
  }

  return {
    command: process.env.ComSpec ?? "cmd.exe",
    commandArgs: [
      "/d",
      "/s",
      "/c",
      [executablePath, ...args].map(quoteSafeWindowsShellArg).join(" "),
    ],
  };
}

async function formatGeneratedDirectory(root) {
  const prettier = await import("prettier");
  const config = (await prettier.resolveConfig(runtimeRoot)) ?? {};
  for (const file of listFiles(root)) {
    const filePath = path.join(root, file);
    const source = readFileSync(filePath, "utf8");
    const formatted = await prettier.format(source, {
      ...config,
      filepath: filePath,
    });
    if (formatted !== source) {
      writeFileSync(filePath, formatted, "utf8");
    }
  }
}

function diffDirectories(leftRoot, rightRoot) {
  const leftFiles = listFiles(leftRoot);
  const rightFiles = listFiles(rightRoot);
  const allFiles = [...new Set([...leftFiles, ...rightFiles])].sort();
  const diff = [];
  for (const file of allFiles) {
    const leftPath = path.join(leftRoot, file);
    const rightPath = path.join(rightRoot, file);
    if (!leftFiles.includes(file)) {
      diff.push(`missing committed file ${file}`);
      continue;
    }
    if (!rightFiles.includes(file)) {
      diff.push(`stale committed file ${file}`);
      continue;
    }
    const left = readFileSync(leftPath, "utf8");
    const right = readFileSync(rightPath, "utf8");
    if (normalizeFile(file, left) !== normalizeFile(file, right)) {
      diff.push(`changed file ${file}`);
    }
  }
  return diff;
}

function listFiles(root) {
  const files = [];
  walk(root, "");
  return files.sort();

  function walk(currentRoot, relativeRoot) {
    for (const entry of readdirSync(currentRoot)) {
      if (entry === "README.md") {
        continue;
      }
      const absolutePath = path.join(currentRoot, entry);
      const relativePath = path.join(relativeRoot, entry);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (stats.isFile()) {
        files.push(relativePath.split(path.sep).join("/"));
      }
    }
  }
}

function normalizeText(value) {
  return value.replace(/\r\n/g, "\n");
}

function normalizeFile(file, value) {
  if (file.endsWith(".json")) {
    return `${stableStringify(JSON.parse(value))}\n`;
  }
  return normalizeText(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function formatCodexInvocation(executablePath, args) {
  return [executablePath, ...args].join(" ");
}

function quoteSafeWindowsShellArg(value) {
  assertSafeWindowsShellArg(value);
  return /[\s()]/.test(value) ? `"${value}"` : value;
}

function assertSafeWindowsShellArg(value) {
  if (/[\r\n&|<>^%"]/.test(value)) {
    throw new Error(
      "Unsafe Codex CLI executable or argument contains Windows shell metacharacters",
    );
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
