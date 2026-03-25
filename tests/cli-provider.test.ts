/**
 * Tests for CLIProvider — the shell-based LLM provider.
 * Covers retry-on-empty-output, --bare injection, and basic spawn behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CLIProvider } from "../src/lib/llm-provider.js";

describe("CLIProvider", () => {
  it("returns stdout from a simple echo command", async () => {
    const provider = new CLIProvider("echo hello");
    // echo ignores stdin but prints "hello"
    const result = await provider.complete("ignored prompt");
    expect(result).toBe("hello");
  });

  it("rejects on non-zero exit code", async () => {
    // bash -c reads stdin fully then exits with code 1
    const provider = new CLIProvider("bash -c 'cat > /dev/null; exit 1'");
    await expect(provider.complete("test")).rejects.toThrow("exited with code");
  });

  it("retries once on empty output then fails", async () => {
    // `cat /dev/null` reads stdin but produces no output
    const provider = new CLIProvider("cat /dev/null");
    await expect(provider.complete("test")).rejects.toThrow("returned empty output");
  }, 15000);

  it("succeeds on command that echoes stdin", async () => {
    const provider = new CLIProvider("cat");
    const result = await provider.complete("hello from stdin");
    expect(result).toBe("hello from stdin");
  });

  it("prepends system prompt when provided", async () => {
    const provider = new CLIProvider("cat");
    const result = await provider.complete("user prompt", { system: "system prompt" });
    expect(result).toBe("system prompt\n\nuser prompt");
  });

  // ── --setting-sources injection for claude CLI ──────

  it("injects --setting-sources '' for claude to prevent hook recursion", () => {
    const provider = new CLIProvider("claude --print");
    expect((provider as any).args).toContain("--setting-sources");
    const idx = (provider as any).args.indexOf("--setting-sources");
    expect((provider as any).args[idx + 1]).toBe("");
  });

  it("does not double-inject --setting-sources when already present", () => {
    const provider = new CLIProvider("claude --print --setting-sources user");
    const count = (provider as any).args.filter((a: string) => a === "--setting-sources").length;
    expect(count).toBe(1);
  });

  it("does not inject --setting-sources for non-claude executables", () => {
    const provider = new CLIProvider("ollama run llama3");
    expect((provider as any).args).not.toContain("--setting-sources");
  });

  it("injects --setting-sources for full-path claude executable", () => {
    const provider = new CLIProvider("/usr/bin/claude --print");
    expect((provider as any).args).toContain("--setting-sources");
  });
});

describe("resolveProvider — resolution order", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean LLM-related env vars
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_CLI_COMMAND;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it("prefers LLM_CLI_COMMAND over ANTHROPIC_API_KEY when both exist", async () => {
    const { resolveProvider } = await import("../src/lib/llm-provider.js");

    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    process.env.LLM_CLI_COMMAND = "echo test";

    const provider = resolveProvider();
    expect(provider).not.toBeNull();
    expect(provider!.name).toMatch(/^cli:/);
  });

  it("falls back to LLM_CLI_COMMAND when no API keys exist", async () => {
    const { resolveProvider } = await import("../src/lib/llm-provider.js");

    process.env.LLM_CLI_COMMAND = "echo test";

    const provider = resolveProvider();
    expect(provider).not.toBeNull();
    expect(provider!.name).toMatch(/^cli:/);
  });

  it("explicit LLM_PROVIDER=cli overrides API keys", async () => {
    const { resolveProvider } = await import("../src/lib/llm-provider.js");

    process.env.LLM_PROVIDER = "cli";
    process.env.LLM_CLI_COMMAND = "echo test";
    process.env.ANTHROPIC_API_KEY = "sk-test-key";

    const provider = resolveProvider();
    expect(provider).not.toBeNull();
    expect(provider!.name).toMatch(/^cli:/);
  });
});
