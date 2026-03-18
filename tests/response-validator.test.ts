/**
 * Tests for response-validator.ts — fake data detection, empty checks, malformed responses.
 */

import { describe, it, expect } from "vitest";
import { validateResponse, type ValidationResult } from "../tools/lib/response-validator.js";

describe("validateResponse", () => {
  // ── Null/Undefined ────────────────────────────

  it("fails on null data", () => {
    const result = validateResponse(null);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("Response data is null or undefined");
  });

  it("fails on undefined data", () => {
    const result = validateResponse(undefined);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("Response data is null or undefined");
  });

  // ── Empty Data ────────────────────────────────

  it("fails on empty string", () => {
    const result = validateResponse("");
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("empty string"))).toBe(true);
  });

  it("fails on whitespace-only string", () => {
    const result = validateResponse("   ");
    expect(result.pass).toBe(false);
  });

  it("fails on empty array", () => {
    const result = validateResponse([]);
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("empty array"))).toBe(true);
  });

  it("fails on empty object", () => {
    const result = validateResponse({});
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("empty object"))).toBe(true);
  });

  // ── Fake Data Patterns ────────────────────────

  it("detects lorem ipsum text", () => {
    const result = validateResponse("Lorem ipsum dolor sit amet");
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("Fake data pattern"))).toBe(true);
  });

  it("detects test data in object fields", () => {
    const result = validateResponse({ text: "test data for demo", title: "real title" });
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("Fake data pattern"))).toBe(true);
  });

  it("detects placeholder text", () => {
    const result = validateResponse({ content: "placeholder" });
    expect(result.pass).toBe(false);
  });

  it("detects sample content", () => {
    const result = validateResponse("sample text for testing");
    expect(result.pass).toBe(false);
  });

  it("detects foo bar", () => {
    const result = validateResponse("foo bar");
    expect(result.pass).toBe(false);
  });

  it("detects TODO marker", () => {
    const result = validateResponse({ text: "TODO" });
    expect(result.pass).toBe(false);
  });

  it("detects dummy text", () => {
    const result = validateResponse("dummy content here");
    expect(result.pass).toBe(false);
  });

  it("detects example data", () => {
    const result = validateResponse("example text for illustration");
    expect(result.pass).toBe(false);
  });

  // ── Uniform Array Detection ───────────────────

  it("detects uniform array items", () => {
    const items = [
      { id: 1, text: "same" },
      { id: 1, text: "same" },
      { id: 1, text: "same" },
    ];
    const result = validateResponse(items);
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("identical"))).toBe(true);
  });

  it("passes non-uniform array items", () => {
    const items = [
      { id: 1, text: "first post about DeFi yields" },
      { id: 2, text: "second post about validator nodes" },
      { id: 3, text: "third post about governance proposals" },
    ];
    const result = validateResponse(items);
    expect(result.pass).toBe(true);
  });

  // ── Valid Data ────────────────────────────────

  it("passes valid string", () => {
    const result = validateResponse("ETH TVL dropped 5% across major lending protocols in the last 24h");
    expect(result.pass).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("passes valid object with string fields", () => {
    const result = validateResponse({
      text: "Aave v3 deposit rates increased to 4.2% APY",
      category: "defi",
      confidence: 85,
    });
    expect(result.pass).toBe(true);
  });

  it("passes valid array of different items", () => {
    const result = validateResponse([
      { txHash: "abc123", text: "First observation" },
      { txHash: "def456", text: "Second observation" },
    ]);
    expect(result.pass).toBe(true);
  });

  it("passes number data", () => {
    const result = validateResponse(42);
    expect(result.pass).toBe(true);
  });

  // ── Options ───────────────────────────────────

  it("respects minNonEmptyFields option", () => {
    const result = validateResponse(
      { title: "DeFi Report", body: "", author: "" },
      { minNonEmptyFields: 2 },
    );
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("non-empty string field"))).toBe(true);
  });

  it("respects extraFakePatterns option", () => {
    const result = validateResponse("REDACTED content here", {
      extraFakePatterns: [/^REDACTED/i],
    });
    expect(result.pass).toBe(false);
  });

  it("respects skipChecks option", () => {
    const result = validateResponse(null, { skipChecks: ["notNull"] });
    // Still fails on notEmpty, but notNull check is skipped
    expect(result.checksRun).toBeLessThan(5);
  });

  // ── Result Shape ──────────────────────────────

  it("returns correct checksRun count", () => {
    const result = validateResponse("valid content");
    expect(result.checksRun).toBe(5);
    expect(result.checksFailed).toBe(0);
  });

  it("returns correct checksFailed count for multiple failures", () => {
    const result = validateResponse(null);
    expect(result.checksFailed).toBeGreaterThanOrEqual(1);
    expect(result.checksRun).toBe(5);
  });
});
