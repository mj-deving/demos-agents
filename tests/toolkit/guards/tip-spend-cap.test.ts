/**
 * Tests for tip spend cap guard.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import {
  checkTipSpendCap,
  recordTip,
} from "../../../src/toolkit/guards/tip-spend-cap.js";
import type { TipPolicy } from "../../../src/toolkit/types.js";

describe("Tip Spend Cap", () => {
  let tempDir: string;
  let store: FileStateStore;
  const WALLET = "demos1tiptest";
  const DEFAULT_POLICY: Required<TipPolicy> = {
    maxPerTip: 10,
    maxPerPost: 5,
    cooldownMs: 60000,
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-tip-"));
    store = new FileStateStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("allows first tip", async () => {
    const error = await checkTipSpendCap(store, WALLET, "tx1", 5, DEFAULT_POLICY);
    expect(error).toBeNull();
  });

  it("enforces max 10 DEM per tip", async () => {
    const error = await checkTipSpendCap(store, WALLET, "tx1", 11, DEFAULT_POLICY);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("SPEND_LIMIT");
    expect(error!.message).toContain("10");
  });

  it("enforces max 5 tips per post per agent", async () => {
    for (let i = 0; i < 5; i++) {
      await recordTip(store, WALLET, "tx1", 1);
    }

    const error = await checkTipSpendCap(store, WALLET, "tx1", 1, DEFAULT_POLICY);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("SPEND_LIMIT");
    expect(error!.message).toContain("5 tips per post");
  });

  it("allows tipping different posts", async () => {
    for (let i = 0; i < 5; i++) {
      await recordTip(store, WALLET, "tx1", 1);
    }

    // Different post should be fine (after cooldown)
    // We bypass cooldown by directly checking cap logic
    const error = await checkTipSpendCap(store, WALLET, "tx2", 1, {
      ...DEFAULT_POLICY,
      cooldownMs: 0, // no cooldown for this test
    });
    expect(error).toBeNull();
  });

  it("enforces 1-minute cooldown between tips", async () => {
    await recordTip(store, WALLET, "tx1", 1);

    const error = await checkTipSpendCap(store, WALLET, "tx2", 1, DEFAULT_POLICY);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("RATE_LIMITED");
    expect(error!.message).toContain("cooldown");
  });

  it("rejects negative tip amount", async () => {
    const error = await checkTipSpendCap(store, WALLET, "tx1", -1, DEFAULT_POLICY);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("INVALID_INPUT");
  });

  it("rejects zero tip amount", async () => {
    const error = await checkTipSpendCap(store, WALLET, "tx1", 0, DEFAULT_POLICY);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("INVALID_INPUT");
  });
});
