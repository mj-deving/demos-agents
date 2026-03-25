import { describe, it, expect } from "vitest";
import {
  validateTrialEntry,
  calculateSummary,
  type ReviewTrialEntry,
} from "../scripts/log-review-trial.js";

describe("review-trial-log", () => {
  describe("validateTrialEntry", () => {
    it("accepts valid fabric-review entry", () => {
      const entry: ReviewTrialEntry = {
        date: "2026-03-25",
        project: "demos-agents",
        tier: "standard",
        tool: "fabric-review",
        findings_count: 4,
        unique_findings: ["unused import", "missing null check"],
        duration_minutes: 8,
        notes: "found real bug",
      };
      expect(validateTrialEntry(entry)).toEqual({ valid: true, errors: [] });
    });

    it("accepts valid simplify entry without notes", () => {
      const entry: ReviewTrialEntry = {
        date: "2026-03-25",
        project: "demos-agents",
        tier: "surgical",
        tool: "simplify",
        findings_count: 2,
        unique_findings: ["redundant wrapper"],
        duration_minutes: 3,
      };
      expect(validateTrialEntry(entry)).toEqual({ valid: true, errors: [] });
    });

    it("rejects invalid tool name", () => {
      const entry = {
        date: "2026-03-25",
        project: "demos-agents",
        tier: "standard",
        tool: "invalid-tool",
        findings_count: 1,
        unique_findings: ["x"],
        duration_minutes: 5,
      } as any;
      const result = validateTrialEntry(entry);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("tool must be 'fabric-review' or 'simplify'");
    });

    it("rejects invalid tier", () => {
      const entry = {
        date: "2026-03-25",
        project: "demos-agents",
        tier: "mega",
        tool: "simplify",
        findings_count: 1,
        unique_findings: ["x"],
        duration_minutes: 5,
      } as any;
      const result = validateTrialEntry(entry);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("tier must be 'surgical', 'standard', or 'complex'");
    });

    it("rejects negative findings_count", () => {
      const entry = {
        date: "2026-03-25",
        project: "demos-agents",
        tier: "standard",
        tool: "fabric-review",
        findings_count: -1,
        unique_findings: [],
        duration_minutes: 5,
      } as any;
      const result = validateTrialEntry(entry);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("findings_count must be a non-negative number");
    });

    it("rejects negative duration", () => {
      const entry = {
        date: "2026-03-25",
        project: "demos-agents",
        tier: "standard",
        tool: "fabric-review",
        findings_count: 1,
        unique_findings: ["x"],
        duration_minutes: -2,
      } as any;
      const result = validateTrialEntry(entry);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("duration_minutes must be a positive number");
    });
  });

  describe("calculateSummary", () => {
    it("calculates avg findings and duration per tool", () => {
      const entries: ReviewTrialEntry[] = [
        {
          date: "2026-03-20",
          project: "demos-agents",
          tier: "standard",
          tool: "fabric-review",
          findings_count: 4,
          unique_findings: ["a", "b", "c", "d"],
          duration_minutes: 8,
        },
        {
          date: "2026-03-21",
          project: "demos-agents",
          tier: "standard",
          tool: "fabric-review",
          findings_count: 6,
          unique_findings: ["a", "b", "c", "d", "e", "f"],
          duration_minutes: 12,
        },
        {
          date: "2026-03-22",
          project: "demos-agents",
          tier: "standard",
          tool: "simplify",
          findings_count: 2,
          unique_findings: ["x", "y"],
          duration_minutes: 3,
        },
        {
          date: "2026-03-23",
          project: "demos-agents",
          tier: "surgical",
          tool: "simplify",
          findings_count: 1,
          unique_findings: ["z"],
          duration_minutes: 2,
        },
      ];

      const summary = calculateSummary(entries);

      expect(summary["fabric-review"].sessions).toBe(2);
      expect(summary["fabric-review"].avgFindings).toBe(5);
      expect(summary["fabric-review"].avgDuration).toBe(10);
      expect(summary["fabric-review"].avgFindingsPerMinute).toBeCloseTo(0.5, 1);

      expect(summary["simplify"].sessions).toBe(2);
      expect(summary["simplify"].avgFindings).toBe(1.5);
      expect(summary["simplify"].avgDuration).toBe(2.5);
      expect(summary["simplify"].avgFindingsPerMinute).toBeCloseTo(0.6, 1);
    });

    it("handles empty entries", () => {
      const summary = calculateSummary([]);
      expect(summary["fabric-review"].sessions).toBe(0);
      expect(summary["fabric-review"].avgFindings).toBe(0);
      expect(summary["simplify"].sessions).toBe(0);
    });

    it("handles single-tool entries", () => {
      const entries: ReviewTrialEntry[] = [
        {
          date: "2026-03-20",
          project: "demos-agents",
          tier: "standard",
          tool: "fabric-review",
          findings_count: 3,
          unique_findings: ["a", "b", "c"],
          duration_minutes: 6,
        },
      ];

      const summary = calculateSummary(entries);
      expect(summary["fabric-review"].sessions).toBe(1);
      expect(summary["fabric-review"].avgFindings).toBe(3);
      expect(summary["simplify"].sessions).toBe(0);
    });
  });
});
