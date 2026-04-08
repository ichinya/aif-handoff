import type { RuntimeCapabilityName } from "./capabilities.js";

export type RuntimeWorkflowKind =
  | "planner"
  | "implementer"
  | "reviewer"
  | "review-security"
  | "review-gate"
  | "chat"
  | "oneshot"
  | string;

export type RuntimeWorkflowFallbackStrategy = "none" | "slash_command";
/**
 * How a logical skill command should be injected into the runtime prompt.
 * - `none`: never prepend a skill command.
 * - `always`: prepend it unconditionally, regardless of fallback strategy.
 * - `fallback`: prepend it only when the workflow falls back from agent definitions.
 */
export type RuntimeSkillCommandMode = "none" | "always" | "fallback";

export type RuntimeSessionReusePolicy = "resume_if_available" | "new_session" | "never";

export interface RuntimeWorkflowPromptInput {
  prompt: string;
  /** @deprecated Use `skillCommand` / `skillCommandMode`. Retained as a legacy alias. */
  fallbackSlashCommand?: string;
  skillCommand?: string;
  skillCommandMode?: RuntimeSkillCommandMode;
  systemPromptAppend?: string;
}

export interface RuntimeWorkflowSpec {
  workflowKind: RuntimeWorkflowKind;
  promptInput: RuntimeWorkflowPromptInput;
  requiredCapabilities: RuntimeCapabilityName[];
  agentDefinitionName?: string;
  fallbackStrategy: RuntimeWorkflowFallbackStrategy;
  sessionReusePolicy: RuntimeSessionReusePolicy;
  metadata?: Record<string, unknown>;
}

export interface RuntimeWorkflowSpecInput {
  workflowKind: RuntimeWorkflowKind;
  prompt: string;
  requiredCapabilities?: RuntimeCapabilityName[];
  agentDefinitionName?: string;
  /** @deprecated Use `skillCommand` / `skillCommandMode`. Retained as a legacy alias. */
  fallbackSlashCommand?: string;
  skillCommand?: string;
  skillCommandMode?: RuntimeSkillCommandMode;
  fallbackStrategy?: RuntimeWorkflowFallbackStrategy;
  sessionReusePolicy?: RuntimeSessionReusePolicy;
  systemPromptAppend?: string;
  metadata?: Record<string, unknown>;
}

function normalizeSkillCommand(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^[/$]+/, "").trim() || undefined;
}

export function createRuntimeWorkflowSpec(input: RuntimeWorkflowSpecInput): RuntimeWorkflowSpec {
  const requiredCapabilities = [...new Set(input.requiredCapabilities ?? [])];
  const skillCommand = normalizeSkillCommand(input.skillCommand ?? input.fallbackSlashCommand);
  // If the caller provides an agent definition, a skill command should only be used as a fallback.
  // Without an agent definition, the skill command becomes the primary invocation path.
  const skillCommandMode =
    input.skillCommandMode ??
    (skillCommand ? (input.agentDefinitionName ? "fallback" : "always") : "none");
  const fallbackStrategy =
    skillCommandMode === "fallback"
      ? "slash_command"
      : (input.fallbackStrategy ?? (input.fallbackSlashCommand ? "slash_command" : "none"));

  return {
    workflowKind: input.workflowKind,
    promptInput: {
      prompt: input.prompt,
      fallbackSlashCommand: input.fallbackSlashCommand,
      skillCommand,
      skillCommandMode,
      systemPromptAppend: input.systemPromptAppend,
    },
    requiredCapabilities,
    agentDefinitionName: input.agentDefinitionName,
    fallbackStrategy,
    sessionReusePolicy: input.sessionReusePolicy ?? "resume_if_available",
    metadata: input.metadata,
  };
}
