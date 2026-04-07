import { describe, expect, it, vi } from "vitest";
import { runHookWithTimeout, type HookResult } from "../../../src/toolkit/util/hook-dispatch.js";

describe("runHookWithTimeout", () => {
  it("returns success with result and elapsed time", async () => {
    const result = await runHookWithTimeout(async () => 42);
    expect(result.ok).toBe(true);
    expect(result.result).toBe(42);
    expect(result.isTimeout).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("returns error on rejection", async () => {
    const result = await runHookWithTimeout(async () => {
      throw new Error("hook failed");
    });
    expect(result.ok).toBe(false);
    expect(result.isTimeout).toBe(false);
    expect(result.error).toBe("hook failed");
    expect(result.result).toBeUndefined();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("returns timeout when hook exceeds timeoutMs", async () => {
    const result = await runHookWithTimeout(
      () => new Promise((r) => setTimeout(() => r("late"), 200)),
      50,
    );
    expect(result.ok).toBe(false);
    expect(result.isTimeout).toBe(true);
    expect(result.result).toBeUndefined();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(45);
  });

  it("uses default timeout of 30000ms", async () => {
    // Fast hook should succeed well within default timeout
    const result = await runHookWithTimeout(async () => "fast");
    expect(result.ok).toBe(true);
    expect(result.result).toBe("fast");
  });

  it("calls observe on error", async () => {
    const observe = vi.fn();
    await runHookWithTimeout(
      async () => { throw new Error("oops"); },
      5000,
      "test-hook",
      observe,
    );
    expect(observe).toHaveBeenCalledWith(
      "hook:error",
      expect.stringContaining("oops"),
      expect.objectContaining({ label: "test-hook" }),
    );
  });

  it("calls observe on timeout", async () => {
    const observe = vi.fn();
    await runHookWithTimeout(
      () => new Promise((r) => setTimeout(() => r("late"), 200)),
      50,
      "slow-hook",
      observe,
    );
    expect(observe).toHaveBeenCalledWith(
      "hook:timeout",
      expect.stringContaining("slow-hook"),
      expect.objectContaining({ timeoutMs: 50 }),
    );
  });

  it("does not call observe on success", async () => {
    const observe = vi.fn();
    await runHookWithTimeout(async () => "ok", 5000, "good-hook", observe);
    expect(observe).not.toHaveBeenCalled();
  });

  it("handles non-Error throws", async () => {
    const result = await runHookWithTimeout(async () => {
      throw "string-error";
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("string-error");
  });

  it("preserves generic type", async () => {
    const result: HookResult<{ name: string }> = await runHookWithTimeout(
      async () => ({ name: "test" }),
    );
    expect(result.ok).toBe(true);
    expect(result.result?.name).toBe("test");
  });
});
