import { describe, expect, it, vi } from "vitest";
import { bootstrapRuntimeRegistry } from "../bootstrap.js";

describe("bootstrapRuntimeRegistry", () => {
  it("creates registry with built-in claude, codex, opencode, and openrouter adapters", async () => {
    const registry = await bootstrapRuntimeRegistry();
    const runtimes = registry.listRuntimes();

    expect(runtimes.length).toBeGreaterThanOrEqual(4);
    expect(runtimes.find((r) => r.id === "claude")).toBeDefined();
    expect(runtimes.find((r) => r.id === "codex")).toBeDefined();
    expect(runtimes.find((r) => r.id === "opencode")).toBeDefined();
    expect(runtimes.find((r) => r.id === "openrouter")).toBeDefined();
  });

  it("claude adapter has expected capabilities", async () => {
    const registry = await bootstrapRuntimeRegistry();
    const claude = registry.resolveRuntime("claude");

    expect(claude.descriptor.capabilities.supportsResume).toBe(true);
    expect(claude.descriptor.capabilities.supportsSessionList).toBe(true);
    expect(claude.descriptor.capabilities.supportsAgentDefinitions).toBe(true);
    expect(claude.descriptor.lightModel).toBe("haiku");
  });

  it("codex adapter has expected capabilities", async () => {
    const registry = await bootstrapRuntimeRegistry();
    const codex = registry.resolveRuntime("codex");

    expect(codex.descriptor.capabilities.supportsResume).toBe(true);
    expect(codex.descriptor.capabilities.supportsSessionList).toBe(false);
    expect(codex.descriptor.lightModel).toBeNull();
  });

  it("openrouter adapter has expected capabilities", async () => {
    const registry = await bootstrapRuntimeRegistry();
    const openrouter = registry.resolveRuntime("openrouter");

    expect(openrouter.descriptor.capabilities.supportsResume).toBe(false);
    expect(openrouter.descriptor.capabilities.supportsSessionList).toBe(false);
    expect(openrouter.descriptor.capabilities.supportsStreaming).toBe(true);
    expect(openrouter.descriptor.capabilities.supportsModelDiscovery).toBe(true);
    expect(openrouter.descriptor.capabilities.supportsCustomEndpoint).toBe(true);
    expect(openrouter.descriptor.defaultTransport).toBe("api");
    expect(openrouter.descriptor.lightModel).toBeNull();
  });

  it("passes logger to registry", async () => {
    const warn = vi.fn();
    const registry = await bootstrapRuntimeRegistry({
      logger: { debug: vi.fn(), warn },
    });

    expect(registry.listRuntimes().length).toBeGreaterThanOrEqual(2);
  });

  it("continues when a runtime module fails to load", async () => {
    const warn = vi.fn();
    const registry = await bootstrapRuntimeRegistry({
      logger: { debug: vi.fn(), warn },
      runtimeModules: ["nonexistent-module-that-does-not-exist"],
    });

    expect(registry.listRuntimes().length).toBeGreaterThanOrEqual(2);
    expect(warn).toHaveBeenCalled();
  });

  it("returns same adapters on repeated calls (no duplication)", async () => {
    const a = await bootstrapRuntimeRegistry();
    const b = await bootstrapRuntimeRegistry();

    // Each call creates a fresh registry
    expect(a).not.toBe(b);
    expect(a.listRuntimes().length).toBe(b.listRuntimes().length);
  });
});
it("opencode adapter has expected capabilities", async () => {
  const registry = await bootstrapRuntimeRegistry();
  const opencode = registry.resolveRuntime("opencode");

  expect(opencode.descriptor.capabilities.supportsResume).toBe(true);
  expect(opencode.descriptor.capabilities.supportsSessionList).toBe(true);
  expect(opencode.descriptor.capabilities.supportsStreaming).toBe(true);
  expect(opencode.descriptor.capabilities.supportsModelDiscovery).toBe(true);
  expect(opencode.descriptor.capabilities.supportsCustomEndpoint).toBe(true);
  expect(opencode.descriptor.defaultTransport).toBe("api");
  expect(opencode.descriptor.lightModel).toBeNull();
});
