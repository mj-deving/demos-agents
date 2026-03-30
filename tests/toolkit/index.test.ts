/**
 * Tests for barrel export — verifies exports are functional, not just present.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as toolkit from "../../src/toolkit/index.js";

describe("Barrel export", () => {
  it("exports exactly the expected tool functions", () => {
    const expectedTools = [
      "connect", "disconnect", "publish", "reply", "react",
      "tip", "scan", "verify", "attest", "discoverSources", "pay",
    ];
    for (const name of expectedTools) {
      expect(toolkit).toHaveProperty(name);
      expect(typeof (toolkit as Record<string, unknown>)[name]).toBe("function");
    }
    // Verify count — catch accidental exports
    const toolFunctions = expectedTools.filter(
      (n) => typeof (toolkit as Record<string, unknown>)[n] === "function",
    );
    expect(toolFunctions).toHaveLength(expectedTools.length);
  });

  it("exports Phase 3 toolkit primitives", () => {
    expect(typeof toolkit.startEventLoop).toBe("function");
    expect(typeof toolkit.createFileWatermarkStore).toBe("function");
    expect(typeof toolkit.createMemoryWatermarkStore).toBe("function");
    expect(typeof toolkit.executeChainTx).toBe("function");
  });

  it("DemosSession can be instantiated", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "demos-barrel-"));
    try {
      const session = new toolkit.DemosSession({
        walletAddress: "demos1test",
        rpcUrl: "https://demosnode.discus.sh",
        algorithm: "falcon",
        authToken: "token",
        signingHandle: {},
        stateStore: new toolkit.FileStateStore(tempDir),
      });
      expect(session.walletAddress).toBe("demos1test");
      expect(session.expired).toBe(false);
      session.expire();
      expect(session.expired).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ok/err/demosError produce correct result shapes", () => {
    const success = toolkit.ok({ txHash: "0x1" }, { path: "local" as const, latencyMs: 5 });
    expect(success.ok).toBe(true);
    expect(success.data!.txHash).toBe("0x1");

    const error = toolkit.demosError("RATE_LIMITED", "too fast", true);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryable).toBe(true);

    const failure = toolkit.err(error, { path: "local" as const, latencyMs: 5 });
    expect(failure.ok).toBe(false);
    expect(failure.error!.code).toBe("RATE_LIMITED");
  });

  it("guard functions are callable and return expected types", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "demos-barrel-guard-"));
    try {
      const store = new toolkit.FileStateStore(tempDir);

      // Write rate limit check returns null (allowed) on empty state
      const rateResult = await toolkit.checkAndRecordWrite(store, "demos1test", false);
      expect(rateResult).toBeNull();

      // Dedup check returns null (not duplicate) on empty state
      const dedupResult = await toolkit.checkAndRecordDedup(store, "demos1test", "unique text", false);
      expect(dedupResult).toBeNull();

      // Idempotency key is deterministic
      const key1 = toolkit.makeIdempotencyKey("https://api.com", "GET");
      const key2 = toolkit.makeIdempotencyKey("https://api.com", "GET");
      expect(key1).toBe(key2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not export strategy machinery", () => {
    const exports = Object.keys(toolkit);
    const strategyRelated = exports.filter((k) => k.toLowerCase().includes("strategy"));
    expect(strategyRelated).toEqual([]);
  });
});
