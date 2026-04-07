import { describe, it, expect } from "vitest";
import {
  checkPublishQuality,
  type QualityGateConfig,
  type QualityGateResult,
} from "../../../src/toolkit/publish/quality-gate.js";

// ── Helpers ────────────────────────────────────────

const LONG_TEXT = "A".repeat(250);
const SHORT_TEXT = "A".repeat(100);

function draft(overrides: Partial<{ text: string; category: string; predicted_reactions: number }> = {}) {
  return {
    text: overrides.text ?? LONG_TEXT,
    category: overrides.category,
    predicted_reactions: overrides.predicted_reactions,
  };
}

// ── Tests ──────────────────────────────────────────

describe("checkPublishQuality", () => {
  describe("text length check", () => {
    it("passes when text meets default minimum (200)", () => {
      const result = checkPublishQuality(draft({ text: "X".repeat(200) }));
      expect(result.pass).toBe(true);
      expect(findCheck(result, "text-length").pass).toBe(true);
    });

    it("fails when text is below default minimum", () => {
      const result = checkPublishQuality(draft({ text: SHORT_TEXT }));
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("text-length");
      expect(findCheck(result, "text-length").pass).toBe(false);
    });

    it("uses custom minTextLength when provided", () => {
      const result = checkPublishQuality(
        draft({ text: "X".repeat(50) }),
        { minTextLength: 40 },
      );
      expect(result.pass).toBe(true);
      expect(findCheck(result, "text-length").pass).toBe(true);
    });

    it("fails with custom minTextLength when text is too short", () => {
      const result = checkPublishQuality(
        draft({ text: "X".repeat(50) }),
        { minTextLength: 100 },
      );
      expect(result.pass).toBe(false);
    });
  });

  describe("predicted reactions check", () => {
    it("skips check when minPredictedReactions is 0 (default)", () => {
      const result = checkPublishQuality(draft());
      const check = result.checks.find((c) => c.name === "predicted-reactions");
      // Either not present or passes (disabled means no gate)
      expect(check === undefined || check.pass).toBe(true);
    });

    it("passes when predicted_reactions meets minimum", () => {
      const result = checkPublishQuality(
        draft({ predicted_reactions: 5 }),
        { minPredictedReactions: 3 },
      );
      expect(result.pass).toBe(true);
      expect(findCheck(result, "predicted-reactions").pass).toBe(true);
    });

    it("fails when predicted_reactions is below minimum", () => {
      const result = checkPublishQuality(
        draft({ predicted_reactions: 1 }),
        { minPredictedReactions: 5 },
      );
      expect(result.pass).toBe(false);
      expect(findCheck(result, "predicted-reactions").pass).toBe(false);
    });

    it("fails when predicted_reactions is undefined but minimum is set", () => {
      const result = checkPublishQuality(
        draft(),
        { minPredictedReactions: 3 },
      );
      expect(result.pass).toBe(false);
      expect(findCheck(result, "predicted-reactions").pass).toBe(false);
    });
  });

  describe("question mark check", () => {
    it("requires question mark for QUESTION category by default", () => {
      const result = checkPublishQuality(draft({ category: "QUESTION", text: LONG_TEXT }));
      expect(result.pass).toBe(false);
      expect(findCheck(result, "question-mark").pass).toBe(false);
    });

    it("passes when QUESTION category text contains ?", () => {
      const result = checkPublishQuality(
        draft({ category: "QUESTION", text: LONG_TEXT + " What do you think?" }),
      );
      expect(result.pass).toBe(true);
      expect(findCheck(result, "question-mark").pass).toBe(true);
    });

    it("does not check question mark for non-QUESTION categories", () => {
      const result = checkPublishQuality(draft({ category: "ANALYSIS" }));
      const check = result.checks.find((c) => c.name === "question-mark");
      expect(check === undefined || check.pass).toBe(true);
    });

    it("skips question mark check when requireQuestionMark is false", () => {
      const result = checkPublishQuality(
        draft({ category: "QUESTION", text: LONG_TEXT }),
        { requireQuestionMark: false },
      );
      // question-mark check either absent or passing
      const check = result.checks.find((c) => c.name === "question-mark");
      expect(check === undefined || check.pass).toBe(true);
    });

    it("does not apply question mark check when category is undefined", () => {
      const result = checkPublishQuality(draft());
      const check = result.checks.find((c) => c.name === "question-mark");
      expect(check === undefined || check.pass).toBe(true);
    });
  });

  describe("overall result", () => {
    it("passes when all checks pass", () => {
      const result = checkPublishQuality(draft({ text: LONG_TEXT, predicted_reactions: 5 }), {
        minPredictedReactions: 3,
      });
      expect(result.pass).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.checks.every((c) => c.pass)).toBe(true);
    });

    it("reason references the first failing check", () => {
      const result = checkPublishQuality(draft({ text: SHORT_TEXT }));
      expect(result.pass).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it("returns individual check details", () => {
      const result = checkPublishQuality(
        draft({ text: SHORT_TEXT, category: "QUESTION" }),
        { minPredictedReactions: 5 },
      );
      expect(result.checks.length).toBeGreaterThanOrEqual(2);
      const failing = result.checks.filter((c) => !c.pass);
      expect(failing.length).toBeGreaterThanOrEqual(2);
    });

    it("is a pure function with no side effects", () => {
      const d = draft();
      const config: QualityGateConfig = { minTextLength: 100 };
      const r1 = checkPublishQuality(d, config);
      const r2 = checkPublishQuality(d, config);
      expect(r1).toEqual(r2);
    });
  });
});

// ── Test Helpers ───────────────────────────────────

function findCheck(result: QualityGateResult, name: string) {
  const check = result.checks.find((c) => c.name === name);
  if (!check) throw new Error(`Check "${name}" not found in results: ${JSON.stringify(result.checks)}`);
  return check;
}
