/**
 * Tests for extensions.ts — hook registry, loader, and dispatchers.
 *
 * Tests the extension hook system with mock hooks, covering:
 * - loadExtensions with various enabled lists
 * - Hook dispatch (runBeforeSense, runBeforePublishDraft, etc.)
 * - Timeout and error isolation
 * - Calibrate extension wiring with runTool dependency
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadExtensions,
  runBeforeSense,
  runBeforePublishDraft,
  runAfterPublishDraft,
  runAfterAct,
  runAfterConfirm,
  HOOK_TIMEOUT_MS,
  type ExtensionHookRegistry,
  type BeforeSenseContext,
  type BeforePublishDraftContext,
  type AfterPublishDraftContext,
  type AfterActContext,
  type AfterConfirmContext,
} from "../src/lib/util/extensions.js";
import type { V2SessionState } from "../src/lib/state.js";

// ── Fixtures ────────────────────────────────────────

function makeBeforeSenseCtx(overrides: Partial<BeforeSenseContext> = {}): BeforeSenseContext {
  return {
    state: { sessionNumber: 1, agentName: "test", startedAt: new Date().toISOString(), pid: 1, phases: {} } as V2SessionState,
    config: { name: "test", loopExtensions: [] } as any,
    flags: { agent: "test", env: ".env", log: "log.jsonl", dryRun: true, pretty: false },
    ...overrides,
  };
}

function makeBeforePublishDraftCtx(): BeforePublishDraftContext {
  return {
    topic: "test-topic",
    category: "ANALYSIS",
    config: { name: "test" } as any,
    state: { sessionNumber: 1 } as any,
  };
}

// ── loadExtensions ──────────────────────────────────

describe("loadExtensions", () => {
  it("returns empty registry for empty enabled list", async () => {
    const registry = await loadExtensions({ enabledExtensions: [] });
    expect(registry.size).toBe(0);
  });

  it("loads observe extension (no-op hooks)", async () => {
    const registry = await loadExtensions({ enabledExtensions: ["observe"] });
    expect(registry.has("observe")).toBe(true);
    const hooks = registry.get("observe")!;
    // observe is inline, no hooks
    expect(hooks.beforeSense).toBeUndefined();
  });

  it("skips unknown extensions silently", async () => {
    const registry = await loadExtensions({ enabledExtensions: ["nonexistent", "observe"] });
    expect(registry.has("nonexistent")).toBe(false);
    expect(registry.has("observe")).toBe(true);
  });

  it("throws when calibrate is enabled without runTool", async () => {
    await expect(
      loadExtensions({ enabledExtensions: ["calibrate"] }),
    ).rejects.toThrow(/calibrate.*requires.*runTool/);
  });

  it("loads calibrate extension with runTool", async () => {
    const runTool = vi.fn().mockResolvedValue({ stats: {} });
    const registry = await loadExtensions({
      enabledExtensions: ["calibrate"],
      runTool,
    });
    expect(registry.has("calibrate")).toBe(true);
    expect(registry.get("calibrate")!.beforeSense).toBeDefined();
  });
});

// ── runBeforeSense ───────────────────────────────────

describe("runBeforeSense", () => {
  it("calls hooks in order for enabled extensions", async () => {
    const callOrder: string[] = [];
    const registry: ExtensionHookRegistry = new Map([
      ["ext-a", { beforeSense: async () => { callOrder.push("a"); } }],
      ["ext-b", { beforeSense: async () => { callOrder.push("b"); } }],
    ]);

    const ctx = makeBeforeSenseCtx();
    await runBeforeSense(registry, ["ext-a", "ext-b"], ctx);

    expect(callOrder).toEqual(["a", "b"]);
  });

  it("skips extensions without beforeSense hook", async () => {
    const spy = vi.fn();
    const registry: ExtensionHookRegistry = new Map([
      ["ext-a", {}],
      ["ext-b", { beforeSense: spy }],
    ]);

    const ctx = makeBeforeSenseCtx();
    await runBeforeSense(registry, ["ext-a", "ext-b"], ctx);

    expect(spy).toHaveBeenCalledOnce();
  });

  it("isolates hook errors — continues to next hook", async () => {
    const spy = vi.fn();
    const registry: ExtensionHookRegistry = new Map([
      ["failing", { beforeSense: async () => { throw new Error("hook error"); } }],
      ["passing", { beforeSense: spy }],
    ]);

    const ctx = makeBeforeSenseCtx();
    await runBeforeSense(registry, ["failing", "passing"], ctx);

    // Second hook still ran
    expect(spy).toHaveBeenCalledOnce();
    // Error recorded
    expect(ctx.hookErrors).toHaveLength(1);
    expect(ctx.hookErrors![0].hook).toBe("failing");
    expect(ctx.hookErrors![0].error).toBe("hook error");
  });

  it("skips extensions not in registry", async () => {
    const registry: ExtensionHookRegistry = new Map();
    const ctx = makeBeforeSenseCtx();

    await runBeforeSense(registry, ["nonexistent"], ctx);
    expect(ctx.hookErrors).toBeUndefined();
  });
});

// ── runBeforePublishDraft ───────────────────────────

describe("runBeforePublishDraft", () => {
  it("short-circuits on rejection", async () => {
    const secondHook = vi.fn();
    const registry: ExtensionHookRegistry = new Map([
      ["gate", {
        beforePublishDraft: async () => ({
          pass: false,
          reason: "no source",
          reasonCode: "NO_SOURCE",
        }),
      }],
      ["other", { beforePublishDraft: secondHook }],
    ]);

    const ctx = makeBeforePublishDraftCtx();
    const decision = await runBeforePublishDraft(registry, ["gate", "other"], ctx);

    expect(decision).toBeDefined();
    expect(decision!.pass).toBe(false);
    // Second hook should NOT have been called
    expect(secondHook).not.toHaveBeenCalled();
  });

  it("returns last passing decision across multiple hooks", async () => {
    const registry: ExtensionHookRegistry = new Map([
      ["first", {
        beforePublishDraft: async () => ({
          pass: true,
          reason: "first-ok",
          reasonCode: "FIRST",
          candidates: [{ sourceId: "s1", url: "https://first.com", method: "dahr" as any }],
        }),
      }],
      ["second", {
        beforePublishDraft: async () => ({
          pass: true,
          reason: "second-ok",
          reasonCode: "SECOND",
          candidates: [{ sourceId: "s2", url: "https://second.com", method: "dahr" as any }],
        }),
      }],
    ]);

    const ctx = makeBeforePublishDraftCtx();
    const decision = await runBeforePublishDraft(registry, ["first", "second"], ctx);

    // Should return LAST passing decision, not first
    expect(decision?.pass).toBe(true);
    expect(decision?.reasonCode).toBe("SECOND");
    expect(decision?.candidates?.[0].sourceId).toBe("s2");
  });

  it("returns void when no hooks have beforePublishDraft", async () => {
    const registry: ExtensionHookRegistry = new Map([
      ["ext", {}],
    ]);

    const ctx = makeBeforePublishDraftCtx();
    const decision = await runBeforePublishDraft(registry, ["ext"], ctx);

    expect(decision).toBeUndefined();
  });
});

// ── runAfterAct ─────────────────────────────────────

describe("runAfterAct", () => {
  it("calls all afterAct hooks (no short-circuit)", async () => {
    const calls: string[] = [];
    const registry: ExtensionHookRegistry = new Map([
      ["a", { afterAct: async () => { calls.push("a"); } }],
      ["b", { afterAct: async () => { calls.push("b"); } }],
    ]);

    const ctx = {
      state: {} as V2SessionState,
      config: {} as any,
      flags: { agent: "t", env: "", log: "", dryRun: true, pretty: false },
    };
    await runAfterAct(registry, ["a", "b"], ctx);

    expect(calls).toEqual(["a", "b"]);
  });
});

// ── HOOK_TIMEOUT_MS ─────────────────────────────────

describe("HOOK_TIMEOUT_MS", () => {
  it("defines longer timeout for lifecycle and calibrate", () => {
    expect(HOOK_TIMEOUT_MS.lifecycle).toBeGreaterThan(30_000);
    expect(HOOK_TIMEOUT_MS.calibrate).toBeGreaterThan(30_000);
  });
});
