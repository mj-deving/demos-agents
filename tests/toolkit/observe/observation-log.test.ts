import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ObservationLog } from "../../../src/toolkit/observe/observation-log.js";
import type { ObservationEntry } from "../../../src/toolkit/observe/observation-log.js";

describe("ObservationLog", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "obslog-"));
    filePath = join(dir, "observations.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("creates file if missing", () => {
      const log = new ObservationLog({ filePath });
      expect(log.size()).toBe(0);
      // File is created on first flush, not on construction
      log.add({ category: "test", sourceId: "s", subject: "x", richness: 10 });
      log.flush();
      const content = readFileSync(filePath, "utf-8");
      expect(JSON.parse(content)).toHaveLength(1);
    });

    it("handles corrupt file gracefully", () => {
      writeFileSync(filePath, "NOT VALID JSON {{{");
      const log = new ObservationLog({ filePath });
      expect(log.size()).toBe(0);
    });

    it("loads existing valid entries", () => {
      const entries: ObservationEntry[] = [
        {
          timestamp: Date.now(),
          category: "oracle",
          sourceId: "price-feed",
          subject: "BTC/USD",
          richness: 75,
        },
      ];
      writeFileSync(filePath, JSON.stringify(entries));
      const log = new ObservationLog({ filePath });
      expect(log.size()).toBe(1);
    });
  });

  describe("add()", () => {
    it("stores entries with auto-timestamp", () => {
      const log = new ObservationLog({ filePath });
      const before = Date.now();
      log.add({
        category: "colony-feeds",
        sourceId: "feed-scanner",
        subject: "ETH market update",
        richness: 60,
      });
      const after = Date.now();

      const entries = log.query();
      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(entries[0].timestamp).toBeLessThanOrEqual(after);
      expect(entries[0].category).toBe("colony-feeds");
      expect(entries[0].sourceId).toBe("feed-scanner");
      expect(entries[0].subject).toBe("ETH market update");
      expect(entries[0].richness).toBe(60);
    });

    it("persists entries to disk after flush", () => {
      const log = new ObservationLog({ filePath });
      log.add({
        category: "oracle",
        sourceId: "price-feed",
        subject: "BTC/USD",
        richness: 80,
      });
      log.flush();

      // Read from disk directly
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(raw).toHaveLength(1);
      expect(raw[0].category).toBe("oracle");
    });

    it("stores optional data field", () => {
      const log = new ObservationLog({ filePath });
      log.add({
        category: "oracle",
        sourceId: "price-feed",
        subject: "BTC/USD",
        richness: 80,
        data: { price: 65000, change: 2.5 },
      });

      const entries = log.query();
      expect(entries[0].data).toEqual({ price: 65000, change: 2.5 });
    });

    it("auto-prunes when exceeding 10000 entries", () => {
      // Pre-populate with 10000 entries, half old and half recent
      const now = Date.now();
      const oldTimestamp = now - 80 * 60 * 60 * 1000; // 80 hours ago (beyond 72h default)
      const entries: ObservationEntry[] = [];

      for (let i = 0; i < 5000; i++) {
        entries.push({
          timestamp: oldTimestamp,
          category: "old",
          sourceId: "gen",
          subject: `old-${i}`,
          richness: 10,
        });
      }
      for (let i = 0; i < 5000; i++) {
        entries.push({
          timestamp: now - 1000, // recent
          category: "recent",
          sourceId: "gen",
          subject: `recent-${i}`,
          richness: 10,
        });
      }

      writeFileSync(filePath, JSON.stringify(entries));
      const log = new ObservationLog({ filePath });

      // Adding one more should trigger auto-prune (total would be 10001)
      log.add({
        category: "new",
        sourceId: "gen",
        subject: "trigger-prune",
        richness: 50,
      });

      // Old entries should be pruned, recent + new should remain
      expect(log.size()).toBeLessThanOrEqual(5002);
      expect(log.size()).toBeGreaterThan(0);

      // The new entry should still be there
      const newEntries = log.query({ category: "new" });
      expect(newEntries).toHaveLength(1);
    });
  });

  describe("query()", () => {
    it("returns all entries when no filters", () => {
      const log = new ObservationLog({ filePath });
      log.add({ category: "oracle", sourceId: "a", subject: "x", richness: 50 });
      log.add({ category: "colony-feeds", sourceId: "b", subject: "y", richness: 60 });
      log.add({ category: "oracle", sourceId: "c", subject: "z", richness: 70 });

      expect(log.query()).toHaveLength(3);
    });

    it("filters by category", () => {
      const log = new ObservationLog({ filePath });
      log.add({ category: "oracle", sourceId: "a", subject: "x", richness: 50 });
      log.add({ category: "colony-feeds", sourceId: "b", subject: "y", richness: 60 });
      log.add({ category: "oracle", sourceId: "c", subject: "z", richness: 70 });

      const oracleEntries = log.query({ category: "oracle" });
      expect(oracleEntries).toHaveLength(2);
      expect(oracleEntries.every((e) => e.category === "oracle")).toBe(true);
    });

    it("filters by since timestamp", () => {
      const now = Date.now();
      const entries: ObservationEntry[] = [
        { timestamp: now - 5000, category: "a", sourceId: "s", subject: "old", richness: 10 },
        { timestamp: now - 1000, category: "a", sourceId: "s", subject: "recent", richness: 10 },
        { timestamp: now, category: "a", sourceId: "s", subject: "now", richness: 10 },
      ];
      writeFileSync(filePath, JSON.stringify(entries));
      const log = new ObservationLog({ filePath });

      const result = log.query({ since: now - 2000 });
      expect(result).toHaveLength(2);
      // newest first
      expect(result[0].subject).toBe("now");
      expect(result[1].subject).toBe("recent");
    });

    it("respects limit parameter", () => {
      const log = new ObservationLog({ filePath });
      for (let i = 0; i < 10; i++) {
        log.add({ category: "test", sourceId: "s", subject: `item-${i}`, richness: 10 });
      }

      const result = log.query({ limit: 3 });
      expect(result).toHaveLength(3);
    });

    it("combines category and since filters", () => {
      const now = Date.now();
      const entries: ObservationEntry[] = [
        { timestamp: now - 5000, category: "oracle", sourceId: "s", subject: "old-oracle", richness: 10 },
        { timestamp: now - 1000, category: "feeds", sourceId: "s", subject: "recent-feeds", richness: 10 },
        { timestamp: now, category: "oracle", sourceId: "s", subject: "new-oracle", richness: 10 },
      ];
      writeFileSync(filePath, JSON.stringify(entries));
      const log = new ObservationLog({ filePath });

      const result = log.query({ category: "oracle", since: now - 2000 });
      expect(result).toHaveLength(1);
      expect(result[0].subject).toBe("new-oracle");
    });
  });

  describe("prune()", () => {
    it("removes entries older than retention period", () => {
      const now = Date.now();
      const entries: ObservationEntry[] = [
        { timestamp: now - 80 * 60 * 60 * 1000, category: "a", sourceId: "s", subject: "expired", richness: 10 },
        { timestamp: now - 10 * 60 * 60 * 1000, category: "a", sourceId: "s", subject: "valid", richness: 10 },
      ];
      writeFileSync(filePath, JSON.stringify(entries));
      const log = new ObservationLog({ filePath });

      log.prune();

      expect(log.size()).toBe(1);
      expect(log.query()[0].subject).toBe("valid");
    });

    it("returns count of removed entries", () => {
      const now = Date.now();
      const entries: ObservationEntry[] = [
        { timestamp: now - 80 * 60 * 60 * 1000, category: "a", sourceId: "s", subject: "e1", richness: 10 },
        { timestamp: now - 80 * 60 * 60 * 1000, category: "a", sourceId: "s", subject: "e2", richness: 10 },
        { timestamp: now - 80 * 60 * 60 * 1000, category: "a", sourceId: "s", subject: "e3", richness: 10 },
        { timestamp: now, category: "a", sourceId: "s", subject: "keep", richness: 10 },
      ];
      writeFileSync(filePath, JSON.stringify(entries));
      const log = new ObservationLog({ filePath });

      const pruned = log.prune();
      expect(pruned).toBe(3);
      expect(log.size()).toBe(1);
    });

    it("returns 0 when nothing to prune", () => {
      const log = new ObservationLog({ filePath });
      log.add({ category: "a", sourceId: "s", subject: "fresh", richness: 10 });

      expect(log.prune()).toBe(0);
    });

    it("respects custom retention hours", () => {
      const now = Date.now();
      const entries: ObservationEntry[] = [
        { timestamp: now - 2 * 60 * 60 * 1000, category: "a", sourceId: "s", subject: "2h-old", richness: 10 },
        { timestamp: now - 30 * 60 * 1000, category: "a", sourceId: "s", subject: "30m-old", richness: 10 },
      ];
      writeFileSync(filePath, JSON.stringify(entries));

      // 1 hour retention — should prune the 2h-old entry
      const log = new ObservationLog({ filePath, retentionHours: 1 });
      const pruned = log.prune();
      expect(pruned).toBe(1);
      expect(log.size()).toBe(1);
      expect(log.query()[0].subject).toBe("30m-old");
    });

    it("persists pruned state to disk", () => {
      const now = Date.now();
      const entries: ObservationEntry[] = [
        { timestamp: now - 80 * 60 * 60 * 1000, category: "a", sourceId: "s", subject: "old", richness: 10 },
        { timestamp: now, category: "a", sourceId: "s", subject: "new", richness: 10 },
      ];
      writeFileSync(filePath, JSON.stringify(entries));
      const log = new ObservationLog({ filePath });
      log.prune();

      // Verify disk state
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(raw).toHaveLength(1);
      expect(raw[0].subject).toBe("new");
    });
  });

  describe("size()", () => {
    it("returns 0 for empty log", () => {
      const log = new ObservationLog({ filePath });
      expect(log.size()).toBe(0);
    });

    it("returns correct count after adds", () => {
      const log = new ObservationLog({ filePath });
      log.add({ category: "a", sourceId: "s", subject: "x", richness: 10 });
      log.add({ category: "b", sourceId: "s", subject: "y", richness: 20 });
      expect(log.size()).toBe(2);
    });

    it("returns correct count after prune", () => {
      const now = Date.now();
      const entries: ObservationEntry[] = [
        { timestamp: now - 80 * 60 * 60 * 1000, category: "a", sourceId: "s", subject: "old", richness: 10 },
        { timestamp: now, category: "a", sourceId: "s", subject: "new", richness: 10 },
      ];
      writeFileSync(filePath, JSON.stringify(entries));
      const log = new ObservationLog({ filePath });
      expect(log.size()).toBe(2);
      log.prune();
      expect(log.size()).toBe(1);
    });
  });
});
