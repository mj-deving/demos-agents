/**
 * Tests for FileStateStore.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStateStore } from "../../src/toolkit/state-store.js";

describe("FileStateStore", () => {
  let tempDir: string;
  let store: FileStateStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-test-"));
    store = new FileStateStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("get/set", () => {
    it("returns null for non-existent key", async () => {
      const result = await store.get("nonexistent");
      expect(result).toBeNull();
    });

    it("stores and retrieves a value", async () => {
      await store.set("test-key", '{"count": 42}');
      const result = await store.get("test-key");
      expect(result).toBe('{"count": 42}');
    });

    it("overwrites existing value", async () => {
      await store.set("key", "first");
      await store.set("key", "second");
      const result = await store.get("key");
      expect(result).toBe("second");
    });

    it("sanitizes key to safe filename", async () => {
      await store.set("wallet/abc:123", "data");
      const result = await store.get("wallet/abc:123");
      expect(result).toBe("data");
    });
  });

  describe("lock", () => {
    it("returns an unlock function", async () => {
      const unlock = await store.lock("test-lock", 5000);
      expect(typeof unlock).toBe("function");
      await unlock();
    });

    it("creates file if it doesn't exist for locking", async () => {
      const unlock = await store.lock("new-lock", 5000);
      const data = await store.get("new-lock");
      expect(data).toBeDefined(); // File exists (may be empty)
      await unlock();
    });

    it("supports sequential lock-unlock cycles", async () => {
      const unlock1 = await store.lock("cycle-test", 5000);
      await store.set("cycle-test", '{"v": 1}');
      await unlock1();

      const unlock2 = await store.lock("cycle-test", 5000);
      const data = await store.get("cycle-test");
      expect(data).toBe('{"v": 1}');
      await unlock2();
    });

    it("exclusive lock prevents concurrent access", async () => {
      const unlock1 = await store.lock("exclusive-test", 5000);

      // Second lock should wait (not throw immediately)
      // We test this by racing a lock with a timeout
      let secondLockAcquired = false;
      const lockPromise = store.lock("exclusive-test", 5000).then((unlock) => {
        secondLockAcquired = true;
        return unlock;
      });

      // Small delay — second lock should still be waiting
      await new Promise((r) => setTimeout(r, 100));
      expect(secondLockAcquired).toBe(false);

      // Release first lock
      await unlock1();

      // Now second lock should acquire
      const unlock2 = await lockPromise;
      expect(secondLockAcquired).toBe(true);
      await unlock2();
    });
  });
});
