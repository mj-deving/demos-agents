/**
 * Tests for write rate limiter guard.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import {
  checkAndRecordWrite,
  getWriteRateRemaining,
} from "../../../src/toolkit/guards/write-rate-limit.js";

describe("Write Rate Limiter", () => {
  let tempDir: string;
  let store: FileStateStore;
  const WALLET = "demos1testaddr";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-rl-"));
    store = new FileStateStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("allows first write", async () => {
    const error = await checkAndRecordWrite(store, WALLET, false);
    expect(error).toBeNull();
  });

  it("enforces 14 posts/day per wallet", async () => {
    // Fill up to limit, advancing time past hourly window between batches
    // so hourly limit (4/hr) doesn't block us before reaching daily limit (14/day)
    vi.useFakeTimers();
    try {
      const HOUR_MS = 60 * 60 * 1000;
      for (let batch = 0; batch < 4; batch++) {
        const count = batch < 2 ? 4 : 3; // 4+4+3+3 = 14
        for (let i = 0; i < count; i++) {
          await checkAndRecordWrite(store, WALLET, true);
        }
        vi.advanceTimersByTime(HOUR_MS + 1);
      }

      const error = await checkAndRecordWrite(store, WALLET, false);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("RATE_LIMITED");
      expect(error!.message).toContain("Daily");
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces 4 posts/hour per wallet", async () => {
    for (let i = 0; i < 4; i++) {
      await checkAndRecordWrite(store, WALLET, true);
    }

    const error = await checkAndRecordWrite(store, WALLET, false);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("RATE_LIMITED");
    expect(error!.message).toContain("Hourly");
  });

  it("uses StateStore with exclusive locking", async () => {
    // Verify state persists across calls (uses store, not memory)
    await checkAndRecordWrite(store, WALLET, true);

    // Create a new store instance pointing to same dir
    const store2 = new FileStateStore(tempDir);
    const remaining = await getWriteRateRemaining(store2, WALLET);
    expect(remaining.dailyRemaining).toBe(13);
    expect(remaining.hourlyRemaining).toBe(3);
  });

  it("different wallets have independent limits", async () => {
    for (let i = 0; i < 4; i++) {
      await checkAndRecordWrite(store, WALLET, true);
    }

    // Different wallet should still be allowed
    const error = await checkAndRecordWrite(store, "demos1other", false);
    expect(error).toBeNull();
  });

  it("reports remaining capacity", async () => {
    const before = await getWriteRateRemaining(store, WALLET);
    expect(before.dailyRemaining).toBe(14);
    expect(before.hourlyRemaining).toBe(4);

    await checkAndRecordWrite(store, WALLET, true);

    const after = await getWriteRateRemaining(store, WALLET);
    expect(after.dailyRemaining).toBe(13);
    expect(after.hourlyRemaining).toBe(3);
  });
});
