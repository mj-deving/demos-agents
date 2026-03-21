import { describe, it, expect, afterEach } from "vitest";
import { calculateQualityScore, logQualityData, type QualityDataEntry } from "../src/lib/quality-score.js";
import * as fs from "fs";
import * as path from "path";

describe("calculateQualityScore", () => {
  it("scores a high-quality attested reply with numeric claims", () => {
    const result = calculateQualityScore({
      text: "BTC at $67,432 (+2.1% 24h) while ETH holds $2,050. Perp L/S ratio at 3.12 signals crowded longs — contrarian threshold breached. This divergence pattern preceded 3 of the last 5 corrections exceeding 8%. The risk-reward setup favors short-term caution despite spot strength. SOL showing similar dynamics with funding rates turning negative across major exchanges, suggesting smart money positioning for a pullback.",
      isReply: true,
      hasAttestation: true,
      agentsReferenced: ["volcker"],
    });

    expect(result.signals.hasNumericClaim).toBe(true);
    expect(result.signals.referencesAgent).toBe(true);
    expect(result.signals.isReply).toBe(true);
    expect(result.attestationGate).toBe(true);
    expect(result.signals.isLongForm).toBe(true);
    expect(result.signals.hasGenericLanguage).toBe(false);
    expect(result.score).toBe(7); // max (attestation is hard gate, not scored)
  });

  it("scores a generic low-quality post low", () => {
    const result = calculateQualityScore({
      text: "Crypto is interesting to see. Time will tell what happens. DYOR.",
    });

    expect(result.signals.hasNumericClaim).toBe(false);
    expect(result.signals.hasGenericLanguage).toBe(true);
    expect(result.score).toBe(0); // -2 for generic but floored at 0
  });

  it("detects dollar amounts as numeric claims", () => {
    const result = calculateQualityScore({
      text: "Market cap reached $2.1T today, a new high for the cycle.",
    });
    expect(result.signals.hasNumericClaim).toBe(true);
    expect(result.breakdown.hasNumericClaim).toBe(2);
  });

  it("detects percentages as numeric claims", () => {
    const result = calculateQualityScore({
      text: "CPI at 3.2% suggests Fed will hold rates through Q3.",
    });
    expect(result.signals.hasNumericClaim).toBe(true);
  });

  it("detects gwei/sats as numeric claims", () => {
    const result = calculateQualityScore({
      text: "Gas at 14 gwei makes L1 transactions viable again.",
    });
    expect(result.signals.hasNumericClaim).toBe(true);
  });

  it("gives +2 for reply posts", () => {
    const result = calculateQualityScore({
      text: "This analysis misses the key factor: institutional flows.",
      isReply: true,
    });
    expect(result.breakdown.isReply).toBe(2);
  });

  it("gives +2 for agent references", () => {
    const result = calculateQualityScore({
      text: "Building on the analysis above with fresh attestation data.",
      agentsReferenced: ["0xabc123"],
    });
    expect(result.breakdown.referencesAgent).toBe(2);
  });

  it("attestation is a hard gate, not a score signal", () => {
    const withAttest = calculateQualityScore({ text: "BTC at $50,000", hasAttestation: true });
    const withoutAttest = calculateQualityScore({ text: "BTC at $50,000", hasAttestation: false });
    // Score should be identical — attestation doesn't affect score
    expect(withAttest.score).toBe(withoutAttest.score);
    // But attestationGate differs
    expect(withAttest.attestationGate).toBe(true);
    expect(withoutAttest.attestationGate).toBe(false);
  });

  it("gives +1 for long-form posts over 400 chars", () => {
    const text = "A".repeat(401);
    const result = calculateQualityScore({ text });
    expect(result.breakdown.isLongForm).toBe(1);
  });

  it("penalizes generic language by -2", () => {
    const result = calculateQualityScore({
      text: "Watch this space for more developments. Not financial advice.",
    });
    expect(result.signals.hasGenericLanguage).toBe(true);
    expect(result.breakdown.hasGenericLanguage).toBe(-2);
  });

  it("floors score at 0 (never negative)", () => {
    const result = calculateQualityScore({
      text: "Stay tuned. This is huge. Let that sink in.",
    });
    expect(result.score).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("maxScore is 7 (attestation is hard gate, not scored)", () => {
    const result = calculateQualityScore({ text: "test" });
    expect(result.maxScore).toBe(7);
  });

  it("returns breakdown for every scored signal (not attestation — that's a hard gate)", () => {
    const result = calculateQualityScore({ text: "simple test post" });
    expect(Object.keys(result.breakdown)).toEqual(
      expect.arrayContaining([
        "hasNumericClaim",
        "referencesAgent",
        "isReply",
        "isLongForm",
        "hasGenericLanguage",
      ])
    );
    // attestation is reported in attestationGate, not breakdown
    expect(result.attestationGate).toBeDefined();
  });
});

describe("logQualityData", () => {
  const testDir = path.join(process.env.HOME || "/tmp", ".config", "demos");
  const testFile = path.join(testDir, "quality-data-test-agent.jsonl");

  afterEach(() => {
    try { fs.unlinkSync(testFile); } catch { /* ignore */ }
  });

  it("writes valid JSONL entry to agent-scoped file", () => {
    const entry: QualityDataEntry = {
      timestamp: "2026-03-21T22:30:00Z",
      agent: "test-agent",
      topic: "bitcoin price",
      category: "ANALYSIS",
      quality_score: 5,
      quality_max: 7,
      quality_breakdown: { hasNumericClaim: 2, referencesAgent: 2, isReply: 0, isLongForm: 1, hasGenericLanguage: 0 },
      predicted_reactions: 12,
      confidence: 80,
      text_length: 450,
      isReply: false,
      hasAttestation: true,
    };

    logQualityData(entry);

    const content = fs.readFileSync(testFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.agent).toBe("test-agent");
    expect(parsed.quality_score).toBe(5);
    expect(parsed.predicted_reactions).toBe(12);
    expect(parsed.quality_breakdown.hasNumericClaim).toBe(2);
  });

  it("appends multiple entries as separate lines", () => {
    const base: QualityDataEntry = {
      timestamp: "2026-03-21T22:30:00Z",
      agent: "test-agent",
      topic: "bitcoin",
      category: "ANALYSIS",
      quality_score: 3,
      quality_max: 7,
      quality_breakdown: {},
      predicted_reactions: 8,
      confidence: 70,
      text_length: 300,
      isReply: false,
      hasAttestation: true,
    };

    logQualityData(base);
    logQualityData({ ...base, topic: "ethereum", quality_score: 5 });

    const lines = fs.readFileSync(testFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).topic).toBe("bitcoin");
    expect(JSON.parse(lines[1]).topic).toBe("ethereum");
  });

  it("never throws on write failure", () => {
    // With an invalid agent name containing path separators, it should not throw
    expect(() => logQualityData({
      timestamp: "2026-03-21T22:30:00Z",
      agent: "../../etc/passwd",
      topic: "test",
      category: "ANALYSIS",
      quality_score: 0,
      quality_max: 7,
      quality_breakdown: {},
      predicted_reactions: 0,
      confidence: 0,
      text_length: 0,
      isReply: false,
      hasAttestation: false,
    })).not.toThrow();
  });
});
