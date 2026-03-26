# Claude Agent SDK Reference

> Source: https://platform.claude.com/docs/en/agent-sdk/overview, https://platform.claude.com/docs/en/agent-sdk/typescript
> Created: 2026-03-26
> Updated: 2026-03-26

## Overview

The Claude Agent SDK (formerly Claude Code SDK) lets you build production AI agents with Claude Code as a library. It provides the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript. Agents can autonomously read files, run commands, search the web, edit code, and more — with built-in tool execution so you don't implement tool loops yourself.

**Packages:**
- TypeScript: `@anthropic-ai/claude-agent-sdk`
- Python: `claude-agent-sdk`

**Authentication:** Set `ANTHROPIC_API_KEY` env var. Also supports Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`), Vertex AI (`CLAUDE_CODE_USE_VERTEX=1`), and Azure (`CLAUDE_CODE_USE_FOUNDRY=1`).

## Core Concepts

**Agent loop**: The SDK handles the tool-use loop internally — you send a prompt, Claude autonomously decides which tools to call, executes them, and continues until the task is complete.

**Built-in tools**: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, AskUserQuestion — all work out of the box without custom implementation.

**Streaming messages**: `query()` returns an async generator that streams `SDKMessage` objects as they arrive, including assistant responses, tool use results, system events, and the final result.

**Sessions**: Maintain context across multiple exchanges. Capture `session_id` from the init message and pass it as `resume` to continue later.

**Subagents**: Spawn specialized child agents via the `Agent` tool with focused instructions, tools, and optional model overrides.

**Hooks**: Callback functions that run at key lifecycle points (PreToolUse, PostToolUse, Stop, SessionStart, etc.) to validate, log, block, or transform agent behavior.

**MCP servers**: Connect to external systems via Model Context Protocol — databases, browsers, APIs.

**Permissions**: Control which tools are auto-approved (`allowedTools`), always denied (`disallowedTools`), or handled by custom logic (`canUseTool`).

## API — TypeScript

### `query()`

Primary function. Creates an async generator streaming messages.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

function query({
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;
```

**Minimal example:**
```typescript
for await (const message of query({
  prompt: "Find and fix the bug in auth.py",
  options: { allowedTools: ["Read", "Edit", "Bash"] }
})) {
  if ("result" in message) console.log(message.result);
}
```

### `tool()`

Creates a type-safe MCP tool definition using Zod schemas.

```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const searchTool = tool(
  "search",
  "Search the web",
  { query: z.string() },
  async ({ query }) => {
    return { content: [{ type: "text", text: `Results for: ${query}` }] };
  },
  { annotations: { readOnlyHint: true, openWorldHint: true } }
);
```

### `createSdkMcpServer()`

Creates an in-process MCP server instance.

```typescript
function createSdkMcpServer(options: {
  name: string;
  version?: string;
  tools?: Array<SdkMcpToolDefinition<any>>;
}): McpSdkServerConfigWithInstance;
```

### `listSessions()`

Lists past sessions with metadata. Filter by directory or list all.

```typescript
function listSessions(options?: {
  dir?: string;
  limit?: number;
  includeWorktrees?: boolean; // default: true
}): Promise<SDKSessionInfo[]>;
```

Returns: `{ sessionId, summary, lastModified, fileSize, customTitle?, firstPrompt?, gitBranch?, cwd? }[]`

### `getSessionMessages()`

Reads messages from a past session transcript.

```typescript
function getSessionMessages(
  sessionId: string,
  options?: { dir?: string; limit?: number; offset?: number }
): Promise<SessionMessage[]>;
```

## Options (Full Reference)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `allowedTools` | `string[]` | `[]` | Tools to auto-approve (does NOT restrict — unlisted tools fall to `permissionMode`) |
| `disallowedTools` | `string[]` | `[]` | Tools to always deny (overrides everything including `bypassPermissions`) |
| `permissionMode` | `PermissionMode` | `'default'` | `'default'` / `'acceptEdits'` / `'bypassPermissions'` / `'plan'` / `'dontAsk'` |
| `canUseTool` | `CanUseTool` | `undefined` | Custom permission callback |
| `cwd` | `string` | `process.cwd()` | Working directory |
| `model` | `string` | CLI default | Claude model to use |
| `fallbackModel` | `string` | `undefined` | Fallback if primary fails |
| `maxTurns` | `number` | `undefined` | Max agentic turns (tool-use round trips) |
| `maxBudgetUsd` | `number` | `undefined` | Max budget in USD |
| `effort` | `'low'|'medium'|'high'|'max'` | `'high'` | Controls thinking depth |
| `thinking` | `ThinkingConfig` | `{ type: 'adaptive' }` | Controls reasoning behavior |
| `systemPrompt` | `string \| { type: 'preset', preset: 'claude_code', append?: string }` | `undefined` | Custom or Claude Code system prompt |
| `agents` | `Record<string, AgentDefinition>` | `undefined` | Programmatic subagent definitions |
| `agent` | `string` | `undefined` | Agent name for main thread |
| `mcpServers` | `Record<string, McpServerConfig>` | `{}` | MCP server configurations |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | `{}` | Hook callbacks |
| `resume` | `string` | `undefined` | Session ID to resume |
| `forkSession` | `boolean` | `false` | Fork instead of continuing when resuming |
| `sessionId` | `string` | Auto-generated | Custom UUID for session |
| `persistSession` | `boolean` | `true` | `false` disables session persistence to disk |
| `continue` | `boolean` | `false` | Continue most recent conversation |
| `settingSources` | `SettingSource[]` | `[]` | Which filesystem settings to load (`'user'`, `'project'`, `'local'`) |
| `tools` | `string[] \| { type: 'preset', preset: 'claude_code' }` | `undefined` | Tool configuration |
| `outputFormat` | `{ type: 'json_schema', schema: JSONSchema }` | `undefined` | Structured output format |
| `plugins` | `SdkPluginConfig[]` | `[]` | Local plugin paths |
| `betas` | `SdkBeta[]` | `[]` | Beta features (e.g. `['context-1m-2025-08-07']`) |
| `includePartialMessages` | `boolean` | `false` | Enable streaming partial messages |
| `enableFileCheckpointing` | `boolean` | `false` | File change tracking for rewinding |
| `additionalDirectories` | `string[]` | `[]` | Extra directories Claude can access |
| `sandbox` | `SandboxSettings` | `undefined` | Sandbox behavior config |
| `env` | `Record<string, string \| undefined>` | `process.env` | Environment variables |
| `abortController` | `AbortController` | `new AbortController()` | Cancel controller |
| `debug` | `boolean` | `false` | Debug mode |
| `debugFile` | `string` | `undefined` | Debug log file path |
| `stderr` | `(data: string) => void` | `undefined` | Stderr callback |
| `promptSuggestions` | `boolean` | `false` | Enable prompt suggestions |
| `allowDangerouslySkipPermissions` | `boolean` | `false` | Required for `bypassPermissions` mode |
| `toolConfig` | `ToolConfig` | `undefined` | Built-in tool behavior config |

## Query Object Methods

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  initializationResult(): Promise<SDKControlInitializeResponse>;
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  supportedAgents(): Promise<AgentInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  accountInfo(): Promise<AccountInfo>;
  reconnectMcpServer(serverName: string): Promise<void>;
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  setMcpServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>;
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  close(): void;
}
```

## AgentDefinition

```typescript
type AgentDefinition = {
  description: string;              // Required: when to use this agent
  prompt: string;                   // Required: agent's system prompt
  tools?: string[];                 // Allowed tools (inherits from parent if omitted)
  disallowedTools?: string[];       // Explicitly disallowed tools
  model?: "sonnet" | "opus" | "haiku" | "inherit";
  mcpServers?: AgentMcpServerSpec[];
  skills?: string[];                // Skills to preload
  maxTurns?: number;
};
```

## MCP Server Configs

```typescript
// Stdio transport
type McpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

// SSE transport
type McpSSEServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};

// HTTP transport
type McpHttpServerConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

// In-process SDK server
type McpSdkServerConfigWithInstance = {
  type: "sdk";
  name: string;
  instance: McpServer;
};
```

## Message Types

`SDKMessage` is a union of all message types emitted by `query()`:

| Type | `type` field | When emitted |
|------|-------------|--------------|
| `SDKSystemMessage` | `"system"` (subtype `"init"`) | Session initialization — contains `session_id`, tools, model, etc. |
| `SDKAssistantMessage` | `"assistant"` | Claude's response with `message: BetaMessage` from Anthropic SDK |
| `SDKUserMessage` | `"user"` | User input or tool results |
| `SDKResultMessage` | `"result"` | Final result — success or error (`error_max_turns`, `error_max_budget_usd`, etc.) |
| `SDKPartialAssistantMessage` | `"stream_event"` | Streaming chunks (requires `includePartialMessages: true`) |
| `SDKCompactBoundaryMessage` | `"system"` (subtype `"compact_boundary"`) | Conversation compaction boundary |
| `SDKStatusMessage` | `"status"` | Status updates |
| `SDKTaskNotificationMessage` | `"task_notification"` | Background task notifications |
| `SDKRateLimitEvent` | Rate limit info | Rate limit events |
| `SDKPromptSuggestionMessage` | Prompt suggestion | Next prompt prediction (requires `promptSuggestions: true`) |

### SDKResultMessage

```typescript
// Success
{ type: "result", subtype: "success", result: string, total_cost_usd: number,
  num_turns: number, duration_ms: number, usage: NonNullableUsage,
  structured_output?: unknown }

// Error
{ type: "result", subtype: "error_max_turns" | "error_during_execution" |
  "error_max_budget_usd" | "error_max_structured_output_retries",
  errors: string[], total_cost_usd: number }
```

### SDKAssistantMessage

```typescript
{ type: "assistant", uuid: UUID, session_id: string,
  message: BetaMessage, // Anthropic SDK message with content, model, stop_reason, usage
  parent_tool_use_id: string | null,
  error?: 'authentication_failed' | 'billing_error' | 'rate_limit' |
          'invalid_request' | 'server_error' | 'max_output_tokens' | 'unknown' }
```

## Hook Events

Available events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PermissionRequest`, `Setup`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`

### Hook Callback Signature

```typescript
type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput>;
```

### HookCallbackMatcher

```typescript
interface HookCallbackMatcher {
  matcher?: string;     // Tool name pattern (e.g. "Edit|Write")
  hooks: HookCallback[];
  timeout?: number;     // Seconds
}
```

### Hook Return Value (SyncHookJSONOutput)

```typescript
type SyncHookJSONOutput = {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: "approve" | "block";
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?: { ... }; // Varies by event
};
```

## Built-in Tool Input Types

All exported from `@anthropic-ai/claude-agent-sdk`:

```typescript
type AgentInput = {
  description: string; prompt: string; subagent_type: string;
  model?: "sonnet"|"opus"|"haiku"; run_in_background?: boolean;
  max_turns?: number; name?: string; isolation?: "worktree";
};

type BashInput = {
  command: string; timeout?: number; description?: string;
  run_in_background?: boolean; dangerouslyDisableSandbox?: boolean;
};

type FileEditInput = { file_path: string; old_string: string; new_string: string; replace_all?: boolean; };
type FileReadInput = { file_path: string; offset?: number; limit?: number; pages?: string; };
type FileWriteInput = { file_path: string; content: string; };
type GlobInput = { pattern: string; path?: string; };
type GrepInput = { pattern: string; path?: string; glob?: string; type?: string;
  output_mode?: "content"|"files_with_matches"|"count"; "-i"?: boolean; };
type WebFetchInput = { url: string; prompt: string; };
type WebSearchInput = { query: string; prompt: string; };

type AskUserQuestionInput = {
  questions: Array<{
    question: string; header: string;
    options: Array<{ label: string; description: string; preview?: string; }>;
    multiSelect: boolean;
  }>;
};
```

## Usage Patterns

### Basic agent with file tools
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find all TODO comments and create a summary",
  options: { allowedTools: ["Read", "Glob", "Grep"] }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Session resume (multi-turn)
```typescript
let sessionId: string | undefined;

for await (const message of query({
  prompt: "Read the authentication module",
  options: { allowedTools: ["Read", "Glob"] }
})) {
  if (message.type === "system" && message.subtype === "init") {
    sessionId = message.session_id;
  }
}

for await (const message of query({
  prompt: "Now find all places that call it",
  options: { resume: sessionId }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Hooks — audit file changes
```typescript
import { query, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { appendFile } from "fs/promises";

const logFileChange: HookCallback = async (input) => {
  const filePath = (input as any).tool_input?.file_path ?? "unknown";
  await appendFile("./audit.log", `${new Date().toISOString()}: modified ${filePath}\n`);
  return {};
};

for await (const message of query({
  prompt: "Refactor utils.py to improve readability",
  options: {
    permissionMode: "acceptEdits",
    hooks: {
      PostToolUse: [{ matcher: "Edit|Write", hooks: [logFileChange] }]
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Subagents
```typescript
for await (const message of query({
  prompt: "Use the code-reviewer agent to review this codebase",
  options: {
    allowedTools: ["Read", "Glob", "Grep", "Agent"],
    agents: {
      "code-reviewer": {
        description: "Expert code reviewer for quality and security reviews.",
        prompt: "Analyze code quality and suggest improvements.",
        tools: ["Read", "Glob", "Grep"]
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### MCP server (Playwright browser)
```typescript
for await (const message of query({
  prompt: "Open example.com and describe what you see",
  options: {
    mcpServers: {
      playwright: { command: "npx", args: ["@playwright/mcp@latest"] }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### In-process MCP server with `tool()` and `createSdkMcpServer()`
```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const myTool = tool("search", "Search the web", { query: z.string() },
  async ({ query }) => ({ content: [{ type: "text", text: `Results for: ${query}` }] }),
  { annotations: { readOnlyHint: true } }
);

const server = createSdkMcpServer({ name: "my-server", tools: [myTool] });

for await (const message of query({
  prompt: "Search for TypeScript best practices",
  options: { mcpServers: { "my-server": server } }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Loading CLAUDE.md project instructions
```typescript
const result = query({
  prompt: "Add a new feature following project conventions",
  options: {
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["project"],
    allowedTools: ["Read", "Write", "Edit"]
  }
});
```

## Configuration

### Setting Sources

| Value | Location | Description |
|-------|----------|-------------|
| `'user'` | `~/.claude/settings.json` | Global user settings |
| `'project'` | `.claude/settings.json` | Shared project settings (version controlled) |
| `'local'` | `.claude/settings.local.json` | Local project settings (gitignored) |

Default: `[]` (no filesystem settings loaded). Must include `'project'` to load CLAUDE.md files.

Precedence (highest to lowest): local > project > user. Programmatic options always override filesystem settings.

### Permission Modes

| Mode | Behavior |
|------|----------|
| `'default'` | Standard permission behavior |
| `'acceptEdits'` | Auto-accept file edits |
| `'bypassPermissions'` | Bypass all checks (requires `allowDangerouslySkipPermissions: true`) |
| `'plan'` | Planning mode — no execution |
| `'dontAsk'` | Deny if not pre-approved (no prompting) |

### ToolAnnotations (for `tool()`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | `string` | `undefined` | Human-readable title |
| `readOnlyHint` | `boolean` | `false` | Tool does not modify environment |
| `destructiveHint` | `boolean` | `true` | May perform destructive updates |
| `idempotentHint` | `boolean` | `false` | Repeated calls are safe |
| `openWorldHint` | `boolean` | `true` | Interacts with external entities |

## Best Practices

1. Use `allowedTools` to pre-approve safe tools; use `disallowedTools` to block dangerous ones — deny rules always win.
2. Use `permissionMode: "dontAsk"` in CI/headless environments to avoid hanging on permission prompts.
3. Set `maxTurns` and `maxBudgetUsd` to bound cost and runtime.
4. Use `settingSources: ["project"]` to load CLAUDE.md files and team-shared settings.
5. Use `systemPrompt: { type: "preset", preset: "claude_code" }` when you want the full Claude Code system prompt.
6. Capture `session_id` from the init message and pass as `resume` for multi-turn workflows.
7. Use `includePartialMessages: true` for real-time streaming UIs.
8. Use `enableFileCheckpointing: true` + `rewindFiles()` for safe rollback of file changes.
9. Use in-process MCP servers (`createSdkMcpServer`) for custom tools without subprocess overhead.
10. Set `CLAUDE_AGENT_SDK_CLIENT_APP` in env to identify your app in User-Agent headers.

## Common Pitfalls

- **Forgetting `settingSources`**: By default SDK loads NO filesystem settings. CLAUDE.md files won't load without `settingSources: ["project"]`.
- **`allowedTools` is not restrictive**: It pre-approves listed tools but doesn't block others. Use `disallowedTools` to restrict.
- **`bypassPermissions` requires opt-in**: Must also set `allowDangerouslySkipPermissions: true`.
- **V2 interface is preview**: A new `send()`/`stream()` API exists but is in preview — use `query()` for production.
- **Branding**: Do not use "Claude Code" branding in your products — use "Claude Agent" or your own branding.

## Version Notes

- The SDK was renamed from "Claude Code SDK" to "Claude Agent SDK". See migration guide at `/docs/en/agent-sdk/migration-guide`.
- TypeScript V2 preview available with `send()` and `stream()` patterns for easier multi-turn conversations.
- TypeScript changelog: https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md
- Python changelog: https://github.com/anthropics/claude-agent-sdk-python/blob/main/CHANGELOG.md

## Related Pages

- Quickstart: `/docs/en/agent-sdk/quickstart`
- Python SDK reference: `/docs/en/agent-sdk/python`
- TypeScript V2 preview: `/docs/en/agent-sdk/typescript-v2-preview`
- Hooks guide: `/docs/en/agent-sdk/hooks`
- Subagents: `/docs/en/agent-sdk/subagents`
- MCP: `/docs/en/agent-sdk/mcp`
- Permissions: `/docs/en/agent-sdk/permissions`
- Sessions: `/docs/en/agent-sdk/sessions`
- User input: `/docs/en/agent-sdk/user-input`
- Structured outputs: `/docs/en/agent-sdk/structured-outputs`
- File checkpointing: `/docs/en/agent-sdk/file-checkpointing`
- Skills: `/docs/en/agent-sdk/skills`
- Plugins: `/docs/en/agent-sdk/plugins`
- Example agents: https://github.com/anthropics/claude-agent-sdk-demos
