import type { RuntimeCapabilities } from "./types.js";
import type { RuntimeWorkflowSpec } from "./workflowSpec.js";

export interface RuntimePromptPolicyLogger {
  debug?(context: Record<string, unknown>, message: string): void;
  warn?(context: Record<string, unknown>, message: string): void;
}

export interface RuntimePromptPolicyInput {
  runtimeId: string;
  capabilities: RuntimeCapabilities;
  workflow: RuntimeWorkflowSpec;
  logger?: RuntimePromptPolicyLogger;
}

export interface RuntimePromptPolicyResult {
  prompt: string;
  systemPromptAppend: string;
  agentDefinitionName?: string;
  renderedSkillCommand?: string;
  usedSkillCommand: boolean;
  usedFallbackSkillCommand: boolean;
  usedFallbackSlashCommand: boolean;
}

const DEFAULT_SKILL_COMMAND_PREFIX = "/";
const SKILL_COMMAND_PREFIX_BY_RUNTIME: Record<string, string> = {
  codex: "$",
};

function prependSkillCommandPrompt(prompt: string, renderedSkillCommand: string): string {
  const trimmedCommand = renderedSkillCommand.trim();
  if (!trimmedCommand) return prompt;

  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.startsWith(trimmedCommand)) return prompt;
  return `${trimmedCommand}\n\n${prompt}`;
}

function renderSkillCommand(runtimeId: string, skillCommand: string): string {
  const normalized = skillCommand.trim().replace(/^[/$]+/, "");
  if (!normalized) return skillCommand;
  const prefix = SKILL_COMMAND_PREFIX_BY_RUNTIME[runtimeId] ?? DEFAULT_SKILL_COMMAND_PREFIX;
  return `${prefix}${normalized}`;
}

export function resolveRuntimePromptPolicy(
  input: RuntimePromptPolicyInput,
): RuntimePromptPolicyResult {
  const canUseAgentDefinition = Boolean(
    input.workflow.agentDefinitionName && input.capabilities.supportsAgentDefinitions,
  );
  const wantsSlashFallback = input.workflow.fallbackStrategy === "slash_command";
  const skillCommand = input.workflow.promptInput.skillCommand?.trim();
  const skillCommandMode = input.workflow.promptInput.skillCommandMode;
  const renderedSkillCommand = skillCommand
    ? renderSkillCommand(input.runtimeId, skillCommand)
    : undefined;
  const hasSkillCommand = Boolean(renderedSkillCommand);
  const useFallbackSkillCommand =
    !canUseAgentDefinition &&
    wantsSlashFallback &&
    skillCommandMode === "fallback" &&
    hasSkillCommand;
  const useAlwaysSkillCommand = skillCommandMode === "always" && hasSkillCommand;
  const useSkillCommand = useAlwaysSkillCommand || useFallbackSkillCommand;

  if (!canUseAgentDefinition && input.workflow.agentDefinitionName) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
        agentDefinitionName: input.workflow.agentDefinitionName,
        hasSkillCommand,
      },
      "Runtime does not support agent definitions, checking workflow fallback strategy",
    );
  }

  if (wantsSlashFallback && !hasSkillCommand) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
      },
      "Workflow requested slash fallback but no fallback slash command was provided",
    );
  }

  const prompt = useSkillCommand
    ? prependSkillCommandPrompt(input.workflow.promptInput.prompt, renderedSkillCommand ?? "")
    : input.workflow.promptInput.prompt;
  const systemPromptAppend = input.workflow.promptInput.systemPromptAppend ?? "";
  const agentDefinitionName = canUseAgentDefinition
    ? input.workflow.agentDefinitionName
    : undefined;

  input.logger?.debug?.(
    {
      runtimeId: input.runtimeId,
      workflowKind: input.workflow.workflowKind,
      usedFallbackSlashCommand: useFallbackSkillCommand,
      usedSkillCommand: useSkillCommand,
      usedFallbackSkillCommand: useFallbackSkillCommand,
      renderedSkillCommand: renderedSkillCommand ?? null,
      skillCommandMode,
      agentDefinitionName: agentDefinitionName ?? null,
      systemPromptAppendLength: systemPromptAppend.length,
    },
    "Resolved runtime workflow prompt policy",
  );

  return {
    prompt,
    systemPromptAppend,
    agentDefinitionName,
    renderedSkillCommand,
    usedSkillCommand: useSkillCommand,
    usedFallbackSkillCommand: useFallbackSkillCommand,
    usedFallbackSlashCommand: useFallbackSkillCommand,
  };
}
