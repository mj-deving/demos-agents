/**
 * Tests for write rate limiter guard.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import {
  checkWriteRateLimit,
  recordWrite,
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
    const error = await checkWriteRateLimit(store, WALLET);
    expect(error).toBeNull();
  });

  it("enforces 14 posts/day per wallet", async () => {
    // Fill up to limit
    for (let i = 0; i < 14; i++) {
      await recordWrite(store, WALLET);
    }

    const error = await checkWriteRateLimit(store, WALLET);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("RATE_LIMITED");
    expect(error!.message).toContain("Daily");
  });

  it("enforces 4 posts/hour per wallet", async () => {
    for (let i = 0; i < 4; i++) {
      await recordWrite(store, WALLET);
    }

    const error = await checkWriteRateLimit(store, WALLET);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("RATE_LIMITED");
    expect(error!.message).toContain("Hourly");
  });

  it("uses StateStore with exclusive locking", async () => {
    // Verify state persists across calls (uses store, not memory)
    await recordWrite(store, WALLET);

    // Create a new store instance pointing to same dir
    const store2 = new FileStateStore(tempDir);
    const remaining = await getWriteRateRemaining(store2, WALLET);
    expect(remaining.dailyRemaining).toBe(13);
    expect(remaining.hourlyRemaining).toBe(3);
  });

  it("different wallets have independent limits", async () => {
    for (let i = 0; i < 4; i++) {
      await recordWrite(store, WALLET);
    }

    // Different wallet should still be allowed
    const error = await checkWriteRateLimit(store, "demos1other");
    expect(error).toBeNull();
  });

  it("reports remaining capacity", async () => {
    const before = await getWriteRateRemaining(store, WALLET);
    expect(before.dailyRemaining).toBe(14);
    expect(before.hourlyRemaining).toBe(4);

    await recordWrite(store, WALLET);

    const after = await getWriteRateRemaining(store, WALLET);
    expect(after.dailyRemaining).toBe(13);
    expect(after.hourlyRemaining).toBe(3);
  });
});
