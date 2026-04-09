import { describe, it, expect } from "vitest";
import { STALE_THRESHOLD_MS, capRichness, truncateSubject } from "../../../src/toolkit/observe/extractors/helpers.js";

describe("extractor helpers", () => {
  describe("STALE_THRESHOLD_MS", () => {
    it("equals 24 hours in milliseconds", () => {
      expect(STALE_THRESHOLD_MS).toBe(86_400_000);
    });
  });

  describe("capRichness", () => {
    it("caps values at 95", () => {
      expect(capRichness(100)).toBe(95);
      expect(capRichness(200)).toBe(95);
      expect(capRichness(96)).toBe(95);
    });

    it("passes through values below 95", () => {
      expect(capRichness(50)).toBe(50);
      expect(capRichness(0)).toBe(0);
      expect(capRichness(94)).toBe(94);
      expect(capRichness(95)).toBe(95);
    });
  });

  describe("truncateSubject", () => {
    it("truncates at 80 characters by default", () => {
      const long = "a".repeat(120);
      expect(truncateSubject(long)).toBe("a".repeat(80));
      expect(truncateSubject(long).length).toBe(80);
    });

    it("returns short strings unchanged", () => {
      expect(truncateSubject("hello")).toBe("hello");
    });

    it("respects custom maxLen", () => {
      const text = "abcdefghij";
      expect(truncateSubject(text, 5)).toBe("abcde");
    });
  });
});
