/**
 * Session transcript — append-only event logger for session observability.
 * TDD: tests written before implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  type ClaimExtractionDetail,
  type MatchScoreDetail,
  type TranscriptEvent,
  type TranscriptMetrics,
  emitTranscriptEvent,
  readTranscript,
  pruneOldTranscripts,
  buildSessionId,
  createTranscriptContext,
} from "../src/lib/transcript.js";

// ── Test Helpers ──────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `transcript-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Types ─────────────────────────────────────────────

describe("transcript types", () => {
  it("TranscriptEvent has required fields", () => {
    const event: TranscriptEvent = {
      schemaVersion: 1,
      sessionId: "sentinel-42",
      agent: "sentinel",
      type: "phase-start",
      phase: "scan",
      timestamp: new Date().toISOString(),
    };
    expect(event.schemaVersion).toBe(1);
    expect(event.sessionId).toBe("sentinel-42");
  });

  it("TranscriptMetrics supports core metrics and claim extraction detail", () => {
    const claimExtraction: ClaimExtractionDetail = {
      claims: ["bitcoin", "$64000", "federal reserve"],
      extraction_method: "llm",
      claim_count: 3,
    };
    const metrics: TranscriptMetrics = {
      tokenCost: undefined, // v1 placeholder
      gatePass: 2,
      gateFail: 1,
      attestationSuccess: 1,
      attestationFailed: 0,
      claimExtraction,
    };
    expect(metrics.gatePass).toBe(2);
    expect(metrics.tokenCost).toBeUndefined();
    expect(metrics.claimExtraction).toEqual(claimExtraction);
  });

  it("TranscriptMetrics supports match score detail", () => {
    const matchScoreDetail: MatchScoreDetail = {
      topic_relevance: 13,
      body_match: 17,
      metrics_overlap: 5,
      metadata_match: 3,
      composite: 38,
      threshold: 30,
      passed: true,
      candidateSourceNames: ["Bitcoin Market Data", "Macro Digest"],
      selectedSourceName: "Bitcoin Market Data",
    };

    const metrics: TranscriptMetrics = { matchScoreDetail };

    expect(metrics.matchScoreDetail).toEqual(matchScoreDetail);
  });
});

// ── buildSessionId ────────────────────────────────────

describe("buildSessionId", () => {
  it("formats as agent-number", () => {
    expect(buildSessionId("sentinel", 42)).toBe("sentinel-42");
  });

  it("handles pioneer agent", () => {
    expect(buildSessionId("pioneer", 35)).toBe("pioneer-35");
  });
});

// ── emitTranscriptEvent ───────────────────────────────

describe("emitTranscriptEvent", () => {
  it("appends valid JSONL to file", () => {
    const filePath = join(tmpDir, "session-1.jsonl");
    const ctx = createTranscriptContext("sentinel", 1, tmpDir);

    emitTranscriptEvent(ctx, { type: "session-start", phase: null });
    emitTranscriptEvent(ctx, { type: "phase-start", phase: "scan" });

    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const event1 = JSON.parse(lines[0]) as TranscriptEvent;
    expect(event1.schemaVersion).toBe(1);
    expect(event1.type).toBe("session-start");
    expect(event1.sessionId).toBe("sentinel-1");

    const event2 = JSON.parse(lines[1]) as TranscriptEvent;
    expect(event2.type).toBe("phase-start");
    expect(event2.phase).toBe("scan");
  });

  it("creates directory if missing", () => {
    const nestedDir = join(tmpDir, "nested", "dir");
    const ctx = createTranscriptContext("sentinel", 1, nestedDir);

    emitTranscriptEvent(ctx, { type: "session-start", phase: null });

    expect(existsSync(join(nestedDir, "session-1.jsonl"))).toBe(true);
  });

  it("includes metrics when provided", () => {
    const ctx = createTranscriptContext("sentinel", 1, tmpDir);

    emitTranscriptEvent(ctx, {
      type: "phase-complete",
      phase: "gate",
      durationMs: 500,
      metrics: { gatePass: 2, gateFail: 1 },
    });

    const events = readTranscript(join(tmpDir, "session-1.jsonl"));
    expect(events[0].metrics?.gatePass).toBe(2);
    expect(events[0].metrics?.gateFail).toBe(1);
  });

  it("persists match score detail when provided", () => {
    const ctx = createTranscriptContext("sentinel", 1, tmpDir);
    const matchScoreDetail: MatchScoreDetail = {
      topic_relevance: 13,
      body_match: 17,
      metrics_overlap: 5,
      metadata_match: 3,
      composite: 38,
      threshold: 30,
      passed: true,
      candidateSourceNames: ["Bitcoin Market Data"],
      selectedSourceName: "Bitcoin Market Data",
    };

    emitTranscriptEvent(ctx, {
      type: "phase-complete",
      phase: "match",
      metrics: { matchScoreDetail },
    });

    const events = readTranscript(join(tmpDir, "session-1.jsonl"));
    expect(events[0].metrics?.matchScoreDetail).toEqual(matchScoreDetail);
  });

  it("includes data when provided", () => {
    const ctx = createTranscriptContext("sentinel", 1, tmpDir);

    emitTranscriptEvent(ctx, {
      type: "phase-complete",
      phase: "scan",
      data: { activityLevel: "HIGH", gapCount: 5 },
    });

    const events = readTranscript(join(tmpDir, "session-1.jsonl"));
    expect(events[0].data).toEqual({ activityLevel: "HIGH", gapCount: 5 });
  });
});

// ── readTranscript ────────────────────────────────────

describe("readTranscript", () => {
  it("parses JSONL file into events", () => {
    const filePath = join(tmpDir, "test.jsonl");
    const event: TranscriptEvent = {
      schemaVersion: 1,
      sessionId: "sentinel-1",
      agent: "sentinel",
      type: "session-start",
      phase: null,
      timestamp: new Date().toISOString(),
    };
    writeFileSync(filePath, JSON.stringify(event) + "\n");

    const events = readTranscript(filePath);
    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe("sentinel-1");
  });

  it("returns empty array for missing file", () => {
    const events = readTranscript(join(tmpDir, "nonexistent.jsonl"));
    expect(events).toEqual([]);
  });

  it("skips malformed lines gracefully", () => {
    const filePath = join(tmpDir, "corrupt.jsonl");
    writeFileSync(filePath, '{"schemaVersion":1,"sessionId":"s-1","agent":"s","type":"session-start","phase":null,"timestamp":"2026-01-01T00:00:00Z"}\nnot json\n');

    const events = readTranscript(filePath);
    expect(events).toHaveLength(1);
  });

  it("returns empty array for empty file", () => {
    const filePath = join(tmpDir, "empty.jsonl");
    writeFileSync(filePath, "");

    const events = readTranscript(filePath);
    expect(events).toEqual([]);
  });
});

// ── pruneOldTranscripts ───────────────────────────────

describe("pruneOldTranscripts", () => {
  it("deletes files older than retention period", () => {
    const oldFile = join(tmpDir, "session-1.jsonl");
    const newFile = join(tmpDir, "session-2.jsonl");
    writeFileSync(oldFile, "old\n");
    writeFileSync(newFile, "new\n");

    // Backdate the old file's mtime (sync to avoid race condition)
    const oldTime = new Date();
    oldTime.setDate(oldTime.getDate() - 31);
    const { utimesSync } = require("node:fs");
    utimesSync(oldFile, oldTime, oldTime);

    pruneOldTranscripts(tmpDir, 30);

    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
  });

  it("handles missing directory gracefully", () => {
    expect(() => pruneOldTranscripts(join(tmpDir, "nonexistent"), 30)).not.toThrow();
  });
});
