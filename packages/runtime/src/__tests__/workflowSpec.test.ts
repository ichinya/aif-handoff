import { describe, expect, it } from "vitest";
import { createRuntimeWorkflowSpec, resolveRuntimePromptPolicy } from "../index.js";

describe("runtime workflow spec + prompt policy", () => {
  it("renders Codex fallback skills with dollar syntax when agent definitions are unavailable", () => {
    const workflow = createRuntimeWorkflowSpec({
      workflowKind: "planner",
      prompt: "Plan this feature",
      agentDefinitionName: "plan-coordinator",
      skillCommand: "aif-plan fast",
      fallbackStrategy: "slash_command",
      requiredCapabilities: ["supportsAgentDefinitions"],
    });

    const resolved = resolveRuntimePromptPolicy({
      runtimeId: "codex",
      capabilities: {
        supportsResume: true,
        supportsSessionList: false,
        supportsAgentDefinitions: false,
        supportsStreaming: true,
        supportsModelDiscovery: false,
        supportsApprovals: true,
        supportsCustomEndpoint: true,
      },
      workflow,
    });

    expect(resolved.usedFallbackSlashCommand).toBe(true);
    expect(resolved.usedFallbackSkillCommand).toBe(true);
    expect(resolved.agentDefinitionName).toBeUndefined();
    expect(resolved.renderedSkillCommand).toBe("$aif-plan fast");
    expect(resolved.prompt).toContain("$aif-plan fast");
  });

  it("keeps agent definition when runtime supports it", () => {
    const workflow = createRuntimeWorkflowSpec({
      workflowKind: "implementer",
      prompt: "Implement this feature",
      agentDefinitionName: "implement-coordinator",
      skillCommand: "aif-implement",
      fallbackStrategy: "slash_command",
      requiredCapabilities: ["supportsAgentDefinitions"],
    });

    const resolved = resolveRuntimePromptPolicy({
      runtimeId: "claude",
      capabilities: {
        supportsResume: true,
        supportsSessionList: true,
        supportsAgentDefinitions: true,
        supportsStreaming: true,
        supportsModelDiscovery: true,
        supportsApprovals: true,
        supportsCustomEndpoint: true,
      },
      workflow,
    });

    expect(resolved.usedFallbackSlashCommand).toBe(false);
    expect(resolved.agentDefinitionName).toBe("implement-coordinator");
    expect(resolved.renderedSkillCommand).toBe("/aif-implement");
    expect(resolved.prompt).toBe("Implement this feature");
  });

  it("renders always-on skill mode using Claude slash syntax", () => {
    const workflow = createRuntimeWorkflowSpec({
      workflowKind: "reviewer",
      prompt: "Review this task",
      skillCommand: "aif-review",
      skillCommandMode: "always",
      requiredCapabilities: ["supportsApprovals", "supportsApprovals"],
    });

    const resolved = resolveRuntimePromptPolicy({
      runtimeId: "claude",
      capabilities: {
        supportsResume: true,
        supportsSessionList: true,
        supportsAgentDefinitions: true,
        supportsStreaming: true,
        supportsModelDiscovery: true,
        supportsApprovals: true,
        supportsCustomEndpoint: true,
      },
      workflow,
    });

    expect(resolved.usedSkillCommand).toBe(true);
    expect(resolved.usedFallbackSkillCommand).toBe(false);
    expect(resolved.renderedSkillCommand).toBe("/aif-review");
    expect(resolved.prompt).toContain("/aif-review");
  });

  it("defaults fallbackStrategy to slash_command when a fallback command is provided", () => {
    const workflow = createRuntimeWorkflowSpec({
      workflowKind: "reviewer",
      prompt: "Review this task",
      fallbackSlashCommand: "/aif-review",
      requiredCapabilities: ["supportsApprovals"],
    });

    expect(workflow.fallbackStrategy).toBe("slash_command");
    expect(workflow.promptInput.skillCommand).toBe("aif-review");
    expect(workflow.promptInput.skillCommandMode).toBe("always");
    expect(workflow.requiredCapabilities).toEqual(["supportsApprovals"]);
    expect(workflow.sessionReusePolicy).toBe("resume_if_available");
  });

  it("defaults fallbackStrategy to none when no slash command is provided", () => {
    const workflow = createRuntimeWorkflowSpec({
      workflowKind: "oneshot",
      prompt: "Generate commit message",
      sessionReusePolicy: "new_session",
    });

    expect(workflow.fallbackStrategy).toBe("none");
    expect(workflow.promptInput.fallbackSlashCommand).toBeUndefined();
    expect(workflow.promptInput.skillCommand).toBeUndefined();
    expect(workflow.promptInput.skillCommandMode).toBe("none");
    expect(workflow.sessionReusePolicy).toBe("new_session");
  });
});
