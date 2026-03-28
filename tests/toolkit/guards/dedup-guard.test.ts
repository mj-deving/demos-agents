/**
 * Tests for dedup guard.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import {
  checkAndRecordDedup,
} from "../../../src/toolkit/guards/dedup-guard.js";

describe("Dedup Guard", () => {
  let tempDir: string;
  let store: FileStateStore;
  const WALLET = "demos1deduptest";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-dedup-"));
    store = new FileStateStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("allows first post", async () => {
    const error = await checkAndRecordDedup(store, WALLET, "Hello world", false);
    expect(error).toBeNull();
  });

  it("rejects duplicate text within 24h window", async () => {
    await checkAndRecordDedup(store, WALLET, "Hello world", true);

    const error = await checkAndRecordDedup(store, WALLET, "Hello world", false);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("DUPLICATE");
  });

  it("uses text-hash for comparison", async () => {
    await checkAndRecordDedup(store, WALLET, "Hello world", true);

    // Different text should be allowed
    const error = await checkAndRecordDedup(store, WALLET, "Hello world!", false);
    expect(error).toBeNull();
  });

  it("allows same text from different wallets", async () => {
    await checkAndRecordDedup(store, WALLET, "Hello world", true);

    const error = await checkAndRecordDedup(store, "demos1other", "Hello world", false);
    expect(error).toBeNull();
  });
});
