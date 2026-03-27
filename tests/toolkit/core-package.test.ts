/**
 * Tests for @demos-agents/core package re-exports.
 *
 * Verifies that the workspace package barrel correctly re-exports
 * all public API surface from the toolkit.
 */

import { describe, it, expect } from "vitest";

describe("@demos-agents/core package", () => {
  it("re-exports connect function", async () => {
    const core = await import("@demos-agents/core");
    expect(typeof core.connect).toBe("function");
  });

  it("re-exports DemosSession class", async () => {
    const core = await import("@demos-agents/core");
    expect(core.DemosSession).toBeDefined();
    expect(typeof core.DemosSession).toBe("function");
  });

  it("re-exports pay function", async () => {
    const core = await import("@demos-agents/core");
    expect(typeof core.pay).toBe("function");
  });

  it("re-exports type helpers (ok, err, demosError)", async () => {
    const core = await import("@demos-agents/core");
    expect(typeof core.ok).toBe("function");
    expect(typeof core.err).toBe("function");
    expect(typeof core.demosError).toBe("function");
  });

  it("re-exports FileStateStore", async () => {
    const core = await import("@demos-agents/core");
    expect(core.FileStateStore).toBeDefined();
    expect(typeof core.FileStateStore).toBe("function");
  });

  it("re-exports all tool functions", async () => {
    const core = await import("@demos-agents/core");
    const tools = ["connect", "disconnect", "publish", "reply", "react", "tip", "scan", "verify", "attest", "discoverSources", "pay"];
    for (const tool of tools) {
      expect(typeof (core as Record<string, unknown>)[tool]).toBe("function");
    }
  });

  it("re-exports validation schemas", async () => {
    const core = await import("@demos-agents/core");
    expect(typeof core.validateInput).toBe("function");
    expect(core.ReactOptionsSchema).toBeDefined();
    expect(core.PayOptionsSchema).toBeDefined();
  });
});
