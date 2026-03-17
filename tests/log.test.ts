import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readSessionLog,
  appendSessionLog,
  writeSessionLog,
  rotateSessionLog,
  resolveLogPath,
  type SessionLogEntry,
} from "../tools/lib/log.js";

// ── Helpers ──────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "log-test-"));
}

function makeEntry(overrides: Partial<SessionLogEntry> = {}): SessionLogEntry {
  return {
    timestamp: new Date().toISOString(),
    txHash: "0xabc123",
    category: "ANALYSIS",
    attestation_type: "dahr",
    hypothesis: "Test hypothesis",
    predicted_reactions: 10,
    agents_referenced: [],
    topic: "test-topic",
    confidence: 80,
    text_preview: "Some preview text",
    tags: ["test"],
    ...overrides,
  };
}

function writeJsonl(path: string, entries: SessionLogEntry[]): void {
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(path, content);
}

// ── readSessionLog ───────────────────────────────

describe("readSessionLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when file does not exist", () => {
    const result = readSessionLog(join(tmpDir, "nonexistent.jsonl"));
    expect(result).toEqual([]);
  });

  it("returns empty array for empty file", () => {
    const path = join(tmpDir, "empty.jsonl");
    writeFileSync(path, "");
    const result = readSessionLog(path);
    expect(result).toEqual([]);
  });

  it("parses single-line JSONL", () => {
    const path = join(tmpDir, "single.jsonl");
    const entry = makeEntry({ topic: "bitcoin" });
    writeJsonl(path, [entry]);
    const result = readSessionLog(path);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe("bitcoin");
  });

  it("parses multi-line JSONL preserving order", () => {
    const path = join(tmpDir, "multi.jsonl");
    const entries = [
      makeEntry({ topic: "first" }),
      makeEntry({ topic: "second" }),
      makeEntry({ topic: "third" }),
    ];
    writeJsonl(path, entries);
    const result = readSessionLog(path);
    expect(result).toHaveLength(3);
    expect(result[0].topic).toBe("first");
    expect(result[2].topic).toBe("third");
  });

  it("throws on invalid JSON line", () => {
    const path = join(tmpDir, "bad.jsonl");
    writeFileSync(path, '{"valid":true}\n{broken\n');
    expect(() => readSessionLog(path)).toThrow(/Invalid JSON on line 2/);
  });

  it("handles whitespace-only file as empty", () => {
    const path = join(tmpDir, "ws.jsonl");
    writeFileSync(path, "   \n  \n ");
    // trim() makes it empty string, so returns []
    const result = readSessionLog(path);
    expect(result).toEqual([]);
  });
});

// ── appendSessionLog ─────────────────────────────

describe("appendSessionLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates file and appends entry when file does not exist", () => {
    const path = join(tmpDir, "new.jsonl");
    const entry = makeEntry({ topic: "new-topic" });
    appendSessionLog(entry, path);
    expect(existsSync(path)).toBe(true);
    const result = readSessionLog(path);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe("new-topic");
  });

  it("appends to existing file without overwriting", () => {
    const path = join(tmpDir, "existing.jsonl");
    const first = makeEntry({ topic: "first" });
    const second = makeEntry({ topic: "second" });
    writeJsonl(path, [first]);
    appendSessionLog(second, path);
    const result = readSessionLog(path);
    expect(result).toHaveLength(2);
    expect(result[0].topic).toBe("first");
    expect(result[1].topic).toBe("second");
  });

  it("writes valid JSON line with newline terminator", () => {
    const path = join(tmpDir, "format.jsonl");
    appendSessionLog(makeEntry(), path);
    const raw = readFileSync(path, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    // Should be parseable as JSON
    expect(() => JSON.parse(raw.trim())).not.toThrow();
  });

  it("preserves all entry fields including optional ones", () => {
    const path = join(tmpDir, "fields.jsonl");
    const entry = makeEntry({
      is_reply: true,
      parent_tx_hash: "0xparent",
      actual_reactions: 15,
      actual_score: 90,
      confidence_gate: ["source-found", "novelty-pass"],
    });
    appendSessionLog(entry, path);
    const result = readSessionLog(path);
    expect(result[0].is_reply).toBe(true);
    expect(result[0].parent_tx_hash).toBe("0xparent");
    expect(result[0].actual_reactions).toBe(15);
    expect(result[0].confidence_gate).toEqual(["source-found", "novelty-pass"]);
  });

  it("handles multiple sequential appends", () => {
    const path = join(tmpDir, "sequential.jsonl");
    for (let i = 0; i < 5; i++) {
      appendSessionLog(makeEntry({ topic: `topic-${i}` }), path);
    }
    const result = readSessionLog(path);
    expect(result).toHaveLength(5);
    expect(result[4].topic).toBe("topic-4");
  });
});

// ── writeSessionLog ──────────────────────────────

describe("writeSessionLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates file with all entries", () => {
    const path = join(tmpDir, "write.jsonl");
    const entries = [makeEntry({ topic: "a" }), makeEntry({ topic: "b" })];
    writeSessionLog(entries, path);
    const result = readSessionLog(path);
    expect(result).toHaveLength(2);
    expect(result[0].topic).toBe("a");
    expect(result[1].topic).toBe("b");
  });

  it("overwrites existing file contents", () => {
    const path = join(tmpDir, "overwrite.jsonl");
    writeJsonl(path, [makeEntry({ topic: "old1" }), makeEntry({ topic: "old2" })]);
    writeSessionLog([makeEntry({ topic: "new-only" })], path);
    const result = readSessionLog(path);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe("new-only");
  });

  it("writes valid JSONL format with trailing newline", () => {
    const path = join(tmpDir, "format.jsonl");
    writeSessionLog([makeEntry(), makeEntry()], path);
    const raw = readFileSync(path, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    lines.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
  });

  it("handles empty entries array", () => {
    const path = join(tmpDir, "empty-write.jsonl");
    writeSessionLog([], path);
    const raw = readFileSync(path, "utf-8");
    // Empty array produces just "\n"
    expect(raw).toBe("\n");
  });
});

// ── rotateSessionLog ─────────────────────────────

describe("rotateSessionLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not rotate when entries <= MAX_ENTRIES (50)", () => {
    const path = join(tmpDir, "small.jsonl");
    const entries = Array.from({ length: 50 }, (_, i) =>
      makeEntry({ topic: `t-${i}` })
    );
    writeJsonl(path, entries);
    const result = rotateSessionLog(path);
    expect(result.rotated).toBe(false);
    expect(result.archived).toBe(0);
    // Original file unchanged
    expect(readSessionLog(path)).toHaveLength(50);
  });

  it("rotates when entries exceed MAX_ENTRIES, keeps newest 50", () => {
    const path = join(tmpDir, "big.jsonl");
    const entries = Array.from({ length: 55 }, (_, i) =>
      makeEntry({ topic: `t-${i}` })
    );
    writeJsonl(path, entries);
    const result = rotateSessionLog(path);
    expect(result.rotated).toBe(true);
    expect(result.archived).toBe(5);
    const remaining = readSessionLog(path);
    expect(remaining).toHaveLength(50);
    // Should keep newest (last 50): t-5 through t-54
    expect(remaining[0].topic).toBe("t-5");
    expect(remaining[49].topic).toBe("t-54");
  });

  it("creates archive file with .archive.jsonl suffix", () => {
    const path = join(tmpDir, "rotate.jsonl");
    const archivePath = join(tmpDir, "rotate.archive.jsonl");
    const entries = Array.from({ length: 52 }, (_, i) =>
      makeEntry({ topic: `t-${i}` })
    );
    writeJsonl(path, entries);
    rotateSessionLog(path);
    expect(existsSync(archivePath)).toBe(true);
    const archived = readSessionLog(archivePath);
    expect(archived).toHaveLength(2);
    expect(archived[0].topic).toBe("t-0");
    expect(archived[1].topic).toBe("t-1");
  });

  it("appends to existing archive file (does not overwrite)", () => {
    const path = join(tmpDir, "multi-rotate.jsonl");
    const archivePath = join(tmpDir, "multi-rotate.archive.jsonl");

    // First rotation: 53 entries -> archive 3, keep 50
    let entries = Array.from({ length: 53 }, (_, i) =>
      makeEntry({ topic: `batch1-${i}` })
    );
    writeJsonl(path, entries);
    rotateSessionLog(path);
    expect(readSessionLog(archivePath)).toHaveLength(3);

    // Add 5 more entries (now 55 total), rotate again -> archive 5 more
    for (let i = 0; i < 5; i++) {
      appendSessionLog(makeEntry({ topic: `batch2-${i}` }), path);
    }
    rotateSessionLog(path);
    // Archive should now have 3 + 5 = 8 entries
    const archived = readSessionLog(archivePath);
    expect(archived).toHaveLength(8);
    expect(archived[0].topic).toBe("batch1-0"); // original archived entries still there
  });

  it("returns { rotated: false, archived: 0 } for missing file", () => {
    const result = rotateSessionLog(join(tmpDir, "nope.jsonl"));
    expect(result.rotated).toBe(false);
    expect(result.archived).toBe(0);
  });
});

// ── resolveLogPath ───────────────────────────────

describe("resolveLogPath", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    delete process.env.AGENT_LOG_PATH;
    delete process.env.SENTINEL_LOG_PATH;
  });

  it("returns flag value when provided", () => {
    const result = resolveLogPath("/tmp/custom.jsonl");
    expect(result).toBe("/tmp/custom.jsonl");
  });

  it("expands ~ in flag value", () => {
    const result = resolveLogPath("~/logs/test.jsonl");
    expect(result).toContain("logs/test.jsonl");
    expect(result).not.toContain("~");
  });

  it("uses AGENT_LOG_PATH env var when no flag", () => {
    process.env.AGENT_LOG_PATH = "/tmp/agent-log.jsonl";
    const result = resolveLogPath();
    expect(result).toBe("/tmp/agent-log.jsonl");
  });

  it("falls back to SENTINEL_LOG_PATH when AGENT_LOG_PATH is not set", () => {
    delete process.env.AGENT_LOG_PATH;
    process.env.SENTINEL_LOG_PATH = "/tmp/sentinel-log.jsonl";
    const result = resolveLogPath();
    expect(result).toBe("/tmp/sentinel-log.jsonl");
  });

  it("AGENT_LOG_PATH takes priority over SENTINEL_LOG_PATH", () => {
    process.env.AGENT_LOG_PATH = "/tmp/agent.jsonl";
    process.env.SENTINEL_LOG_PATH = "/tmp/sentinel.jsonl";
    const result = resolveLogPath();
    expect(result).toBe("/tmp/agent.jsonl");
  });

  it("uses default path with agent name when no flag or env", () => {
    delete process.env.AGENT_LOG_PATH;
    delete process.env.SENTINEL_LOG_PATH;
    const result = resolveLogPath(undefined, "crawler");
    expect(result).toMatch(/\.crawler-session-log\.jsonl$/);
  });

  it("defaults agent name to sentinel", () => {
    delete process.env.AGENT_LOG_PATH;
    delete process.env.SENTINEL_LOG_PATH;
    const result = resolveLogPath();
    expect(result).toMatch(/\.sentinel-session-log\.jsonl$/);
  });

  it("flag takes priority over env vars", () => {
    process.env.AGENT_LOG_PATH = "/tmp/env.jsonl";
    const result = resolveLogPath("/tmp/flag.jsonl");
    expect(result).toBe("/tmp/flag.jsonl");
  });
});
