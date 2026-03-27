/**
 * Tests for 429 backoff retry guard.
 */

import { describe, it, expect, vi } from "vitest";
import { withBackoff } from "../../../src/toolkit/guards/backoff.js";
import { ok, err, demosError } from "../../../src/toolkit/types.js";
import type { ToolResult } from "../../../src/toolkit/types.js";

describe("Backoff Guard", () => {
  it("returns success on first attempt", async () => {
    const op = vi.fn(async (): Promise<ToolResult<string>> =>
      ok("done", { path: "local", latencyMs: 10 }),
    );

    const result = await withBackoff(op);
    expect(result.ok).toBe(true);
    expect(result.data).toBe("done");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries with exponential delay max 3 times", async () => {
    let attempts = 0;
    const op = vi.fn(async (): Promise<ToolResult<string>> => {
      attempts++;
      if (attempts < 3) {
        return err(
          demosError("RATE_LIMITED", "429 Too Many Requests", true),
          { path: "local", latencyMs: 10 },
        );
      }
      return ok("success after retries", { path: "local", latencyMs: 10 });
    });

    const result = await withBackoff(op);
    expect(result.ok).toBe(true);
    expect(result.data).toBe("success after retries");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it(
    "returns error after all retries exhausted",
    async () => {
      const op = vi.fn(async (): Promise<ToolResult<string>> =>
        err(
          demosError("RATE_LIMITED", "429", true),
          { path: "local", latencyMs: 10 },
        ),
      );

      const result = await withBackoff(op);
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("RATE_LIMITED");
      expect(result.error!.message).toContain("3 retries");
      // 1 initial + 3 retries = 4 calls
      expect(op).toHaveBeenCalledTimes(4);
    },
    15000,
  );

  it("does not retry non-retryable errors", async () => {
    const op = vi.fn(async (): Promise<ToolResult<string>> =>
      err(
        demosError("INVALID_INPUT", "bad data", false),
        { path: "local", latencyMs: 10 },
      ),
    );

    const result = await withBackoff(op);
    expect(result.ok).toBe(false);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-rate-limited errors", async () => {
    const op = vi.fn(async (): Promise<ToolResult<string>> =>
      err(
        demosError("AUTH_FAILED", "unauthorized", true),
        { path: "local", latencyMs: 10 },
      ),
    );

    const result = await withBackoff(op);
    expect(result.ok).toBe(false);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries NETWORK_ERROR", async () => {
    let attempts = 0;
    const op = vi.fn(async (): Promise<ToolResult<string>> => {
      attempts++;
      if (attempts < 2) {
        return err(
          demosError("NETWORK_ERROR", "timeout", true),
          { path: "local", latencyMs: 10 },
        );
      }
      return ok("recovered", { path: "local", latencyMs: 10 });
    });

    const result = await withBackoff(op);
    expect(result.ok).toBe(true);
    expect(op).toHaveBeenCalledTimes(2);
  });
});
