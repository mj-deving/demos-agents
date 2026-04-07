/**
 * Topic-to-domain vocabulary tests.
 *
 * Verifies that signal topic strings from the colony are correctly expanded
 * into source domain tags, bridging natural-language signals to the catalog
 * index used by selectSourcesByIntent.
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect } from "vitest";

import {
  TOPIC_DOMAIN_VOCABULARY,
  expandTopicToDomains,
} from "../../../src/toolkit/sources/topic-vocabulary.js";

// ── Helper ───────────────────────────────────────────

/** Tokenize a signal topic the same way deriveIntentsFromSignalTopics does. */
function tokenize(topic: string): string[] {
  const STOP_WORDS = new Set([
    "the", "and", "from", "for", "with", "into", "that", "this",
    "are", "was", "will", "has", "have", "had", "not", "but",
    "its", "all", "can", "may", "via", "per",
  ]);
  return topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t));
}

// ── TOPIC_DOMAIN_VOCABULARY ──────────────────────────

describe("TOPIC_DOMAIN_VOCABULARY", () => {
  it("is a non-empty record of string arrays", () => {
    expect(Object.keys(TOPIC_DOMAIN_VOCABULARY).length).toBeGreaterThan(10);
    for (const [key, domains] of Object.entries(TOPIC_DOMAIN_VOCABULARY)) {
      expect(typeof key).toBe("string");
      expect(Array.isArray(domains)).toBe(true);
      expect(domains.length).toBeGreaterThan(0);
    }
  });

  it("all keys are lowercase", () => {
    for (const key of Object.keys(TOPIC_DOMAIN_VOCABULARY)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it("all domain values are lowercase strings", () => {
    for (const domains of Object.values(TOPIC_DOMAIN_VOCABULARY)) {
      for (const d of domains) {
        expect(typeof d).toBe("string");
        expect(d).toBe(d.toLowerCase());
      }
    }
  });
});

// ── expandTopicToDomains ─────────────────────────────

describe("expandTopicToDomains", () => {
  it("PBOC Yuan Defense → macro, forex, currency, economics", () => {
    const tokens = tokenize("China PBOC Yuan Defense");
    const domains = expandTopicToDomains(tokens);
    expect(domains).toContain("macro");
    expect(domains).toContain("forex");
    expect(domains).toContain("currency");
    expect(domains).toContain("economics");
  });

  it("BTC Macro Pressure from Geopolitics → macro, geopolitics + passthrough tokens", () => {
    const tokens = tokenize("BTC Macro Pressure from Geopolitics PBOC");
    const domains = expandTopicToDomains(tokens);
    expect(domains).toContain("macro");
    expect(domains).toContain("forex");
    expect(domains).toContain("currency");
    // "geopolitics" is in vocabulary
    expect(domains).toContain("cross-domain");
    expect(domains).toContain("news");
    // passthrough tokens
    expect(domains).toContain("btc");
    expect(domains).toContain("pressure");
  });

  it("Crypto Regulatory Scrutiny MiCA and CFTC → regulation, crypto, derivatives", () => {
    const tokens = tokenize("Crypto Regulatory Scrutiny MiCA and CFTC");
    const domains = expandTopicToDomains(tokens);
    expect(domains).toContain("regulation");
    expect(domains).toContain("crypto");
    expect(domains).toContain("derivatives");
    expect(domains).toContain("cross-domain");
  });

  it("DXY USD Liquidity Tightening → forex, currency, macro, economics", () => {
    const tokens = tokenize("DXY USD Liquidity Tightening");
    const domains = expandTopicToDomains(tokens);
    expect(domains).toContain("forex");
    expect(domains).toContain("currency");
    expect(domains).toContain("macro");
    expect(domains).toContain("economics");
  });

  it("Aave DeFi Negative Yield Spread → defi, tvl, derivatives", () => {
    const tokens = tokenize("Aave DeFi Negative Yield Spread");
    const domains = expandTopicToDomains(tokens);
    expect(domains).toContain("defi");
    expect(domains).toContain("tvl");
    expect(domains).toContain("derivatives");
  });

  it("passes through unknown tokens as-is", () => {
    const domains = expandTopicToDomains(["xyzunknown", "foobarbaz"]);
    expect(domains).toContain("xyzunknown");
    expect(domains).toContain("foobarbaz");
  });

  it("returns empty array for empty input", () => {
    expect(expandTopicToDomains([])).toEqual([]);
  });

  it("deduplicates domain tags", () => {
    // "pboc" and "yuan" both map to "forex" — should appear once
    const domains = expandTopicToDomains(["pboc", "yuan"]);
    const forexCount = domains.filter(d => d === "forex").length;
    expect(forexCount).toBe(1);
  });

  it("is case-insensitive on input tokens", () => {
    const upper = expandTopicToDomains(["PBOC"]);
    const lower = expandTopicToDomains(["pboc"]);
    expect(upper.sort()).toEqual(lower.sort());
  });
});
