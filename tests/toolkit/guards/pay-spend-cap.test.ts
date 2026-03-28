/**
 * Tests for pay spend cap guard (rolling 24h).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import {
  reservePaySpend,
} from "../../../src/toolkit/guards/pay-spend-cap.js";
import type { PayPolicy } from "../../../src/toolkit/types.js";

describe("Pay Spend Cap", () => {
  let tempDir: string;
  let store: FileStateStore;
  const WALLET = "demos1paytest";
  const DEFAULT_POLICY: Required<PayPolicy> = {
    maxPerCall: 100,
    rolling24hCap: 100,
    trustedPayees: [],
    requirePayeeApproval: false,
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-pay-"));
    store = new FileStateStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("allows first payment", async () => {
    const { error } = await reservePaySpend(store, WALLET, 10, "https://example.com/1", DEFAULT_POLICY);
    expect(error).toBeNull();
  });

  it("enforces rolling 24h cumulative cap", async () => {
    // Spend 90 DEM (reservePaySpend records the amount atomically)
    await reservePaySpend(store, WALLET, 90, "https://example.com/1", DEFAULT_POLICY);

    // 15 more should exceed the 100 cap
    const { error } = await reservePaySpend(store, WALLET, 15, "https://example.com/2", DEFAULT_POLICY);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("SPEND_LIMIT");
    expect(error!.message).toContain("24h");
  });

  it("persists per wallet address not per session", async () => {
    // Record payment in one store instance
    await reservePaySpend(store, WALLET, 95, "https://example.com/1", DEFAULT_POLICY);

    // Create new store pointing to same dir (simulates new process)
    const store2 = new FileStateStore(tempDir);
    const { error } = await reservePaySpend(store2, WALLET, 10, "https://example.com/2", DEFAULT_POLICY);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("SPEND_LIMIT");
  });

  it("requires maxSpend parameter per call (rejects zero)", async () => {
    const { error } = await reservePaySpend(store, WALLET, 0, "https://example.com/1", DEFAULT_POLICY);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("INVALID_INPUT");
  });

  it("rejects negative amount", async () => {
    const { error } = await reservePaySpend(store, WALLET, -5, "https://example.com/1", DEFAULT_POLICY);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("INVALID_INPUT");
  });

  it("enforces per-call max", async () => {
    const { error } = await reservePaySpend(store, WALLET, 150, "https://example.com/1", DEFAULT_POLICY);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("SPEND_LIMIT");
    expect(error!.message).toContain("per-call max");
  });

  it("different wallets have independent caps", async () => {
    await reservePaySpend(store, WALLET, 95, "https://example.com/1", DEFAULT_POLICY);

    const { error } = await reservePaySpend(store, "demos1other", 10, "https://example.com/2", DEFAULT_POLICY);
    expect(error).toBeNull();
  });
});
