/**
 * Tests for improvement loop utilities — WS1.
 *
 * Covers: dedup (normalize + isDuplicate), EMA calibration,
 * bounds enforcement, age-out, and surface-top-items.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeDescription,
  isDuplicate,
  emaCalibrationOffset,
  ageOutStale,
  surfaceTopItems,
  EMA_ALPHA,
  OFFSET_MIN,
  OFFSET_MAX,
  VALID_TRANSITIONS,
  type Improvement,
} from "../src/lib/improvement-utils.js";

// ── Helper ──────────────────────────────────────────

function makeItem(overrides: Partial<Improvement> = {}): Improvement {
  return {
    id: "IMP-1-1",
    session: 1,
    timestamp: "2026-03-10T00:00:00Z",
    source: "Q1",
    description: "Test description",
    target: "test.ts",
    status: "proposed",
    evidence: ["test evidence"],
    history: [{ action: "proposed", timestamp: "2026-03-10T00:00:00Z" }],
    ...overrides,
  };
}

// ── normalizeDescription ────────────────────────────

describe("normalizeDescription", () => {
  it("strips Q1: prefix and lowercases", () => {
    expect(normalizeDescription("Q1: Some finding")).toBe("some finding");
  });

  it("strips Q2: prefix and lowercases", () => {
    expect(normalizeDescription("Q2: Another finding")).toBe("another finding");
  });

  it("strips Q3: prefix and lowercases", () => {
    expect(normalizeDescription("Q3: Outperformed by +12rx")).toBe("outperformed by N");
  });

  it("strips Q4: prefix and lowercases", () => {
    expect(normalizeDescription("Q4: Stale item")).toBe("stale item");
  });

  it("strips S{N}: prefix and lowercases", () => {
    expect(normalizeDescription("S16: Reply flag is --reply-to")).toBe("reply flag is --reply-to");
    // S16: prefix is stripped first, then no remaining numbers to strip
  });

  it("trims whitespace and lowercases", () => {
    expect(normalizeDescription("  Some Finding  ")).toBe("some finding");
  });

  it("leaves descriptions without prefixes unchanged (lowercased)", () => {
    expect(normalizeDescription("No prefix here")).toBe("no prefix here");
  });

  it("only strips first prefix (not nested)", () => {
    expect(normalizeDescription("Q1: Q2: double prefix")).toBe("qN: double prefix");
  });

  it("case-insensitive prefix matching", () => {
    expect(normalizeDescription("q1: lowercase prefix")).toBe("lowercase prefix");
  });

  it("strips numeric values for fuzzy dedup", () => {
    expect(normalizeDescription("systematic over-prediction by 13.0rx — update calibration offset"))
      .toBe(normalizeDescription("systematic over-prediction by 10.6rx — update calibration offset"));
  });

  it("strips numeric values but preserves semantic meaning", () => {
    const a = normalizeDescription("over-prediction by 8.7rx — update calibration offset");
    const b = normalizeDescription("under-prediction by 4.0rx — update calibration offset");
    expect(a).not.toBe(b); // different semantic meaning preserved
  });

  it("strips hash-like values (outperformer observations)", () => {
    expect(normalizeDescription("Q3: 762eba88 outperformed by +12rx (ANALYSIS)"))
      .toBe(normalizeDescription("Q3: e79258d2 outperformed by +10rx (ANALYSIS)"));
  });
});

// ── isDuplicate ─────────────────────────────────────

describe("isDuplicate", () => {
  it("detects exact duplicate among proposed items", () => {
    const items = [makeItem({ description: "Some finding" })];
    const result = isDuplicate(items, "Some finding");
    expect(result.duplicate).toBe(true);
    expect(result.existingId).toBe("IMP-1-1");
  });

  it("detects duplicate with prefix difference (Q1: vs Q2:)", () => {
    const items = [makeItem({ description: "Q1: Calibration offset stale" })];
    const result = isDuplicate(items, "Q2: Calibration offset stale");
    expect(result.duplicate).toBe(true);
  });

  it("detects duplicate with case difference", () => {
    const items = [makeItem({ description: "Calibration Offset Stale" })];
    const result = isDuplicate(items, "calibration offset stale");
    expect(result.duplicate).toBe(true);
  });

  it("returns false for unique description", () => {
    const items = [makeItem({ description: "Existing finding" })];
    const result = isDuplicate(items, "Completely different");
    expect(result.duplicate).toBe(false);
    expect(result.existingId).toBeUndefined();
  });

  it("ignores items with terminal status (rejected)", () => {
    const items = [makeItem({ description: "Old finding", status: "rejected" })];
    const result = isDuplicate(items, "Old finding");
    expect(result.duplicate).toBe(false);
  });

  it("ignores items with terminal status (stale)", () => {
    const items = [makeItem({ description: "Old finding", status: "stale" })];
    const result = isDuplicate(items, "Old finding");
    expect(result.duplicate).toBe(false);
  });

  it("ignores items with terminal status (verified)", () => {
    const items = [makeItem({ description: "Done finding", status: "verified" })];
    const result = isDuplicate(items, "Done finding");
    expect(result.duplicate).toBe(false);
  });

  it("matches against approved items", () => {
    const items = [makeItem({ description: "Approved finding", status: "approved" })];
    const result = isDuplicate(items, "Approved finding");
    expect(result.duplicate).toBe(true);
  });

  it("matches against applied items", () => {
    const items = [makeItem({ description: "Applied finding", status: "applied" })];
    const result = isDuplicate(items, "Applied finding");
    expect(result.duplicate).toBe(true);
  });

  it("detects duplicate when only numeric values differ (calibration)", () => {
    const items = [makeItem({ description: "Systematic over-prediction by 13.0rx — update calibration offset" })];
    const result = isDuplicate(items, "Systematic over-prediction by 10.6rx — update calibration offset");
    expect(result.duplicate).toBe(true);
  });

  it("detects duplicate when only hash and number differ (outperformers)", () => {
    const items = [makeItem({ description: "Q3: 762eba88 outperformed by +12rx (ANALYSIS)" })];
    const result = isDuplicate(items, "Q3: e79258d2 outperformed by +10rx (ANALYSIS)");
    expect(result.duplicate).toBe(true);
  });

  it("does not false-positive on semantically different descriptions", () => {
    const items = [makeItem({ description: "DAHR posts underperforming" })];
    const result = isDuplicate(items, "Reply threads outperform top-level posts");
    expect(result.duplicate).toBe(false);
  });
});

// ── emaCalibrationOffset ────────────────────────────

describe("emaCalibrationOffset", () => {
  it("calculates EMA correctly for positive error", () => {
    // new = 0.3 * 4 + 0.7 * 5 = 1.2 + 3.5 = 4.7
    const result = emaCalibrationOffset(5, 4);
    expect(result).toBeCloseTo(4.7);
  });

  it("calculates EMA correctly for negative error", () => {
    // new = 0.3 * (-2) + 0.7 * 5 = -0.6 + 3.5 = 2.9
    const result = emaCalibrationOffset(5, -2);
    expect(result).toBeCloseTo(2.9);
  });

  it("enforces upper bound", () => {
    // new = 0.3 * 100 + 0.7 * 14 = 30 + 9.8 = 39.8 → clamped to 15
    const result = emaCalibrationOffset(14, 100);
    expect(result).toBe(OFFSET_MAX);
  });

  it("enforces lower bound at -15", () => {
    // new = 0.3 * (-100) + 0.7 * (-4) = -30 + -2.8 = -32.8 → clamped to -15
    const result = emaCalibrationOffset(-4, -100);
    expect(result).toBe(OFFSET_MIN);
    expect(OFFSET_MIN).toBe(-15);
  });

  it("converges toward stable error over multiple iterations", () => {
    let offset = 0;
    const stableError = 4;
    // After many iterations, should converge near stableError
    for (let i = 0; i < 50; i++) {
      offset = emaCalibrationOffset(offset, stableError);
    }
    expect(offset).toBeCloseTo(stableError, 1);
  });

  it("stays at 0 when error is 0 and offset is 0", () => {
    expect(emaCalibrationOffset(0, 0)).toBe(0);
  });

  it("uses correct alpha value", () => {
    expect(EMA_ALPHA).toBe(0.3);
  });
});

// ── ageOutStale ─────────────────────────────────────

describe("ageOutStale", () => {
  it("marks items older than maxAge sessions as stale", () => {
    const items = [
      makeItem({ session: 1, status: "proposed" }),
      makeItem({ id: "IMP-2-1", session: 15, status: "proposed" }),
    ];
    const count = ageOutStale(items, 25, 20);
    expect(count).toBe(1);
    expect(items[0].status).toBe("stale");
    expect(items[1].status).toBe("proposed");
  });

  it("does not touch non-proposed items", () => {
    const items = [
      makeItem({ session: 1, status: "approved" }),
    ];
    const count = ageOutStale(items, 25, 20);
    expect(count).toBe(0);
    expect(items[0].status).toBe("approved");
  });

  it("adds history entry for stale transition", () => {
    const items = [makeItem({ session: 1 })];
    ageOutStale(items, 25, 20);
    const lastHistory = items[0].history[items[0].history.length - 1];
    expect(lastHistory.action).toBe("stale");
    expect(lastHistory.detail).toContain("24 sessions");
  });

  it("returns 0 when no items qualify", () => {
    const items = [makeItem({ session: 20 })];
    expect(ageOutStale(items, 25, 20)).toBe(0);
  });

  it("uses default maxAge of 20", () => {
    const items = [makeItem({ session: 1 })];
    ageOutStale(items, 21);
    expect(items[0].status).toBe("stale");
  });
});

// ── surfaceTopItems ─────────────────────────────────

describe("surfaceTopItems", () => {
  it("returns oldest proposed items first", () => {
    const items = [
      makeItem({ id: "IMP-3-1", session: 3, status: "proposed" }),
      makeItem({ id: "IMP-1-1", session: 1, status: "proposed" }),
      makeItem({ id: "IMP-2-1", session: 2, status: "proposed" }),
    ];
    const top = surfaceTopItems(items, 2);
    expect(top).toHaveLength(2);
    expect(top[0].id).toBe("IMP-1-1");
    expect(top[1].id).toBe("IMP-2-1");
  });

  it("filters out non-proposed items", () => {
    const items = [
      makeItem({ id: "IMP-1-1", session: 1, status: "approved" }),
      makeItem({ id: "IMP-2-1", session: 2, status: "proposed" }),
    ];
    const top = surfaceTopItems(items);
    expect(top).toHaveLength(1);
    expect(top[0].id).toBe("IMP-2-1");
  });

  it("defaults to 3 items", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `IMP-${i}-1`, session: i + 1, status: "proposed" })
    );
    expect(surfaceTopItems(items)).toHaveLength(3);
  });

  it("returns empty array when no proposed items", () => {
    expect(surfaceTopItems([])).toEqual([]);
  });
});

// ── VALID_TRANSITIONS ───────────────────────────────

describe("VALID_TRANSITIONS", () => {
  it("allows proposed → stale", () => {
    expect(VALID_TRANSITIONS.proposed).toContain("stale");
  });

  it("allows proposed → approved", () => {
    expect(VALID_TRANSITIONS.proposed).toContain("approved");
  });

  it("allows proposed → rejected", () => {
    expect(VALID_TRANSITIONS.proposed).toContain("rejected");
  });
});
