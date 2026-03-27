/**
 * Tests for pay receipt log guard.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import {
  makeIdempotencyKey,
  checkPayReceipt,
  recordPayReceipt,
} from "../../../src/toolkit/guards/pay-receipt-log.js";
import type { PayReceipt } from "../../../src/toolkit/guards/pay-receipt-log.js";

describe("Pay Receipt Log", () => {
  let tempDir: string;
  let store: FileStateStore;
  const WALLET = "demos1receipttest";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-receipt-"));
    store = new FileStateStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("idempotency key", () => {
    it("generates deterministic key from url+method+body", () => {
      const key1 = makeIdempotencyKey("https://api.com/data", "GET");
      const key2 = makeIdempotencyKey("https://api.com/data", "GET");
      expect(key1).toBe(key2);
    });

    it("different URLs produce different keys", () => {
      const key1 = makeIdempotencyKey("https://api.com/a");
      const key2 = makeIdempotencyKey("https://api.com/b");
      expect(key1).not.toBe(key2);
    });

    it("different methods produce different keys", () => {
      const key1 = makeIdempotencyKey("https://api.com/data", "GET");
      const key2 = makeIdempotencyKey("https://api.com/data", "POST");
      expect(key1).not.toBe(key2);
    });

    it("different bodies produce different keys", () => {
      const key1 = makeIdempotencyKey("https://api.com", "POST", { a: 1 });
      const key2 = makeIdempotencyKey("https://api.com", "POST", { a: 2 });
      expect(key1).not.toBe(key2);
    });
  });

  describe("receipt persistence", () => {
    it("persists txHash, URL, amount, timestamp", async () => {
      const receipt: PayReceipt = {
        txHash: "0xabc",
        url: "https://api.com/data",
        amount: 5,
        timestamp: Date.now(),
        idempotencyKey: makeIdempotencyKey("https://api.com/data"),
      };

      await recordPayReceipt(store, WALLET, receipt);

      const found = await checkPayReceipt(
        store,
        WALLET,
        receipt.idempotencyKey,
      );
      expect(found).not.toBeNull();
      expect(found!.txHash).toBe("0xabc");
      expect(found!.url).toBe("https://api.com/data");
      expect(found!.amount).toBe(5);
    });

    it("returns null for unknown idempotency key", async () => {
      const found = await checkPayReceipt(store, WALLET, "nonexistent");
      expect(found).toBeNull();
    });

    it("prevents duplicate payments", async () => {
      const key = makeIdempotencyKey("https://api.com/data");
      const receipt: PayReceipt = {
        txHash: "0xabc",
        url: "https://api.com/data",
        amount: 5,
        timestamp: Date.now(),
        idempotencyKey: key,
      };

      await recordPayReceipt(store, WALLET, receipt);

      // Second check should find existing receipt
      const found = await checkPayReceipt(store, WALLET, key);
      expect(found).not.toBeNull();
      expect(found!.txHash).toBe("0xabc");
    });
  });
});
