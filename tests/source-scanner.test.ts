/**
 * Source scanner — Phase 2 of intent-driven scanning.
 *
 * Tests cover: ScanIntent types, deriveIntentsFromTopics, source selection by intent,
 * scan orchestration with mock fetches, pretty-print output, and budget enforcement.
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  type ScanIntent,
  type SourceScanResult,
  type SourceScanOptions,
  type TopicSuggestion,
  deriveIntentsFromTopics,
  selectSourcesByIntent,
  signalsToSuggestions,
  mergeAndDedup,
} from "../src/lib/source-scanner.js";

import type { SourceRecordV2, SourceIndex, AgentSourceView, AgentName } from "../src/lib/sources/catalog.js";
import type { EvidenceEntry } from "../src/lib/sources/providers/types.js";

// ── Test Helpers ──────────────────────────────────────

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "test-source-1",
    name: "Test Source",
    provider: "test",
    url: "https://test.com/api",
    urlPattern: "test.com/api",
    domainTags: ["crypto"],
    topics: ["bitcoin"],
    responseFormat: "json",
    scope: { visibility: "global", importedFrom: [] },
    runtime: {
      timeoutMs: 5000,
      retry: { maxAttempts: 2, backoffMs: 1000, retryOn: ["timeout"] },
    },
    trustTier: "established",
    status: "active",
    rating: {
      overall: 80, uptime: 90, relevance: 80, freshness: 85,
      sizeStability: 90, engagement: 70, trust: 85,
      testCount: 10, successCount: 9, consecutiveFailures: 0,
    },
    lifecycle: {
      discoveredAt: "2026-01-01T00:00:00Z",
      discoveredBy: "manual",
    },
    ...overrides,
  } as SourceRecordV2;
}

function makeIndex(sources: SourceRecordV2[]): SourceIndex {
  const byId = new Map<string, SourceRecordV2>();
  const byTopicToken = new Map<string, Set<string>>();
  const byDomainTag = new Map<string, Set<string>>();
  const byProvider = new Map<string, Set<string>>();
  const byAgent = new Map<AgentName, Set<string>>();
  const byMethod = { TLSN: new Set<string>(), DAHR: new Set<string>() };

  for (const s of sources) {
    byId.set(s.id, s);
    for (const tag of s.domainTags) {
      if (!byDomainTag.has(tag)) byDomainTag.set(tag, new Set());
      byDomainTag.get(tag)!.add(s.id);
    }
    for (const topic of s.topics || []) {
      const tokens = topic.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
      for (const tok of tokens) {
        if (!byTopicToken.has(tok)) byTopicToken.set(tok, new Set());
        byTopicToken.get(tok)!.add(s.id);
      }
    }
    if (!byProvider.has(s.provider)) byProvider.set(s.provider, new Set());
    byProvider.get(s.provider)!.add(s.id);
  }

  return { byId, byTopicToken, byDomainTag, byProvider, byAgent, byMethod };
}

function makeSourceView(sources: SourceRecordV2[]): AgentSourceView {
  return {
    agent: "sentinel",
    catalogVersion: 2,
    sources,
    index: makeIndex(sources),
  };
}

// ── ScanIntent Types ──────────────────────────────────

describe("ScanIntent types", () => {
  it("ScanIntent has required fields", () => {
    const intent: ScanIntent = {
      description: "Monitor crypto prices for significant moves",
      domains: ["crypto", "prices"],
      topics: ["bitcoin", "ethereum"],
      signals: [
        { type: "change", metric: "price", threshold: 5 },
        { type: "threshold", metric: "price", above: 100000 },
      ],
    };
    expect(intent.description).toBeTruthy();
    expect(intent.domains).toHaveLength(2);
    expect(intent.topics).toHaveLength(2);
    expect(intent.signals).toHaveLength(2);
  });

  it("ScanIntent supports optional maxSources", () => {
    const intent: ScanIntent = {
      description: "Test",
      domains: [],
      topics: ["bitcoin"],
      signals: [{ type: "change", metric: "*", threshold: 10 }],
      maxSources: 3,
    };
    expect(intent.maxSources).toBe(3);
  });
});

// ── deriveIntentsFromTopics ───────────────────────────

describe("deriveIntentsFromTopics", () => {
  it("derives one intent per primary topic", () => {
    const intents = deriveIntentsFromTopics({
      primary: ["bitcoin", "ethereum"],
      secondary: ["solana"],
    });
    expect(intents).toHaveLength(2);
    expect(intents[0].topics).toContain("bitcoin");
    expect(intents[1].topics).toContain("ethereum");
  });

  it("each derived intent has a wildcard change signal", () => {
    const intents = deriveIntentsFromTopics({ primary: ["bitcoin"], secondary: [] });
    expect(intents[0].signals).toHaveLength(1);
    expect(intents[0].signals[0].type).toBe("change");
    expect(intents[0].signals[0].metric).toBe("*");
  });

  it("derived intents have maxSources=3 default", () => {
    const intents = deriveIntentsFromTopics({ primary: ["test"], secondary: [] });
    expect(intents[0].maxSources).toBe(3);
  });

  it("handles empty topics gracefully", () => {
    const intents = deriveIntentsFromTopics({ primary: [], secondary: [] });
    expect(intents).toHaveLength(0);
  });
});

// ── selectSourcesByIntent ─────────────────────────────

describe("selectSourcesByIntent", () => {
  const cryptoSource = makeSource({
    id: "coingecko-btc",
    name: "CoinGecko BTC",
    provider: "coingecko",
    domainTags: ["crypto", "prices"],
    topics: ["bitcoin", "btc"],
  });

  const macroSource = makeSource({
    id: "fred-gdp",
    name: "FRED GDP",
    provider: "fred",
    domainTags: ["macro", "economics"],
    topics: ["gdp", "growth"],
  });

  const ethSource = makeSource({
    id: "coingecko-eth",
    name: "CoinGecko ETH",
    provider: "coingecko",
    domainTags: ["crypto", "prices"],
    topics: ["ethereum", "eth"],
  });

  it("selects sources matching intent domain tags", () => {
    const sourceView = makeSourceView([cryptoSource, macroSource]);
    const intent: ScanIntent = {
      description: "Check crypto",
      domains: ["crypto"],
      topics: ["bitcoin"],
      signals: [{ type: "change", metric: "*", threshold: 5 }],
    };
    const selected = selectSourcesByIntent(intent, sourceView);
    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(selected.some(s => s.id === "coingecko-btc")).toBe(true);
    expect(selected.some(s => s.id === "fred-gdp")).toBe(false);
  });

  it("selects sources matching intent topic tokens", () => {
    const sourceView = makeSourceView([cryptoSource, ethSource]);
    const intent: ScanIntent = {
      description: "Check ethereum",
      domains: ["crypto"],
      topics: ["ethereum"],
      signals: [{ type: "change", metric: "*", threshold: 5 }],
    };
    const selected = selectSourcesByIntent(intent, sourceView);
    expect(selected.some(s => s.id === "coingecko-eth")).toBe(true);
  });

  it("respects maxSources limit", () => {
    const sources = Array.from({ length: 10 }, (_, i) =>
      makeSource({
        id: `src-${i}`,
        name: `Source ${i}`,
        domainTags: ["crypto"],
        topics: ["bitcoin"],
      })
    );
    const sourceView = makeSourceView(sources);
    const intent: ScanIntent = {
      description: "Test",
      domains: ["crypto"],
      topics: ["bitcoin"],
      signals: [{ type: "change", metric: "*", threshold: 5 }],
      maxSources: 3,
    };
    const selected = selectSourcesByIntent(intent, sourceView);
    expect(selected.length).toBeLessThanOrEqual(3);
  });

  it("filters out non-active sources", () => {
    const degraded = makeSource({
      id: "degraded-1",
      domainTags: ["crypto"],
      topics: ["bitcoin"],
      status: "degraded",
    });
    const archived = makeSource({
      id: "archived-1",
      domainTags: ["crypto"],
      topics: ["bitcoin"],
      status: "archived",
    });
    const sourceView = makeSourceView([cryptoSource, degraded, archived]);
    const intent: ScanIntent = {
      description: "Test",
      domains: ["crypto"],
      topics: ["bitcoin"],
      signals: [{ type: "change", metric: "*", threshold: 5 }],
    };
    const selected = selectSourcesByIntent(intent, sourceView);
    // Active + degraded allowed, archived not
    const ids = selected.map(s => s.id);
    expect(ids).toContain("coingecko-btc");
    expect(ids).toContain("degraded-1");
    expect(ids).not.toContain("archived-1");
  });

  it("returns empty when no sources match", () => {
    const sourceView = makeSourceView([macroSource]);
    const intent: ScanIntent = {
      description: "Check crypto",
      domains: ["crypto"],
      topics: ["bitcoin"],
      signals: [{ type: "change", metric: "*", threshold: 5 }],
    };
    const selected = selectSourcesByIntent(intent, sourceView);
    expect(selected).toHaveLength(0);
  });

  it("deduplicates sources matched via both domain and topic", () => {
    const sourceView = makeSourceView([cryptoSource]);
    const intent: ScanIntent = {
      description: "Check bitcoin crypto",
      domains: ["crypto"],
      topics: ["bitcoin"],
      signals: [{ type: "change", metric: "*", threshold: 5 }],
    };
    const selected = selectSourcesByIntent(intent, sourceView);
    // Should not contain duplicates
    const ids = selected.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── signalsToSuggestions ──────────────────────────────

describe("signalsToSuggestions", () => {
  it("converts signals to gate suggestions with priority bonus", () => {
    const signals = [{
      source: makeSource(),
      rule: { type: "change" as const, metric: "price", threshold: 5 },
      strength: 2.0,
      currentValue: 115,
      baselineValue: 100,
      changePercent: 15,
      summary: "price changed +15.0% (100 → 115)",
      evidence: {
        id: "e1",
        bodyText: "test",
        topics: ["bitcoin"],
        raw: {},
        metrics: { price: 115 },
      },
      fetchResult: { ok: true, attempts: 1, totalMs: 200, response: { url: "https://test.com", status: 200, headers: {}, bodyText: "{}" } },
    }];

    const suggestions = signalsToSuggestions(signals, 0.3);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].topic).toContain("price");
    expect(suggestions[0].priority).toBeGreaterThan(2.0); // strength + 0.5 bonus
    expect(suggestions[0].attestationCost).toBe(0);
  });

  it("filters signals below minSignalStrength", () => {
    const signals = [{
      source: makeSource(),
      rule: { type: "threshold" as const, metric: "price", above: 100 },
      strength: 0.1,
      currentValue: 110,
      summary: "price = 110 (above threshold 100)",
      evidence: { id: "e1", bodyText: "test", topics: ["bitcoin"], raw: {}, metrics: { price: 110 } },
      fetchResult: { ok: true, attempts: 1, totalMs: 200, response: { url: "https://test.com", status: 200, headers: {}, bodyText: "{}" } },
    }];

    const suggestions = signalsToSuggestions(signals, 0.5);
    expect(suggestions).toHaveLength(0);
  });

  it("maps anti-signal to OPINION category", () => {
    const signals = [{
      source: makeSource(),
      rule: { type: "anti-signal" as const, metric: "price" },
      strength: 1.5,
      currentValue: 64000,
      summary: "Feed claims BTC at $70K, source shows $64000",
      evidence: { id: "e1", bodyText: "test", topics: ["bitcoin"], raw: {}, metrics: { price: 64000 } },
      fetchResult: { ok: true, attempts: 1, totalMs: 200, response: { url: "https://test.com", status: 200, headers: {}, bodyText: "{}" } },
    }];

    const suggestions = signalsToSuggestions(signals, 0);
    expect(suggestions[0].category).toBe("OPINION");
  });

  it("maps non-anti-signal to ANALYSIS category", () => {
    const signals = [{
      source: makeSource(),
      rule: { type: "change" as const, metric: "price", threshold: 5 },
      strength: 2.0,
      currentValue: 115,
      summary: "price changed +15.0%",
      evidence: { id: "e1", bodyText: "test", topics: ["bitcoin"], raw: {}, metrics: { price: 115 } },
      fetchResult: { ok: true, attempts: 1, totalMs: 200, response: { url: "https://test.com", status: 200, headers: {}, bodyText: "{}" } },
    }];

    const suggestions = signalsToSuggestions(signals, 0);
    expect(suggestions[0].category).toBe("ANALYSIS");
  });
});

// ── mergeAndDedup ─────────────────────────────────────

describe("mergeAndDedup", () => {
  it("ISC-23: places source suggestions first", () => {
    const feedSuggestions: TopicSuggestion[] = [
      { topic: "ethereum defi", category: "ANALYSIS", reason: "feed scan" },
    ];
    const sourceSuggestions: TopicSuggestion[] = [
      { topic: "bitcoin price", category: "ANALYSIS", reason: "source scan signal" },
    ];

    const merged = mergeAndDedup(feedSuggestions, sourceSuggestions);
    expect(merged.length).toBe(2);
    // Source suggestions should be first
    expect(merged[0].topic).toBe("bitcoin price");
    expect(merged[1].topic).toBe("ethereum defi");
  });

  it("ISC-24: deduplicates overlapping topics", () => {
    const feedSuggestions: TopicSuggestion[] = [
      { topic: "bitcoin markets", category: "ANALYSIS", reason: "feed" },
    ];
    const sourceSuggestions: TopicSuggestion[] = [
      { topic: "bitcoin price", category: "ANALYSIS", reason: "source" },
    ];

    const merged = mergeAndDedup(feedSuggestions, sourceSuggestions);
    // "bitcoin" overlaps — source version wins (appears first)
    expect(merged.length).toBe(1);
    expect(merged[0].reason).toBe("source");
  });

  it("keeps both when topics have no token overlap", () => {
    const feedSuggestions: TopicSuggestion[] = [
      { topic: "gdp growth", category: "ANALYSIS", reason: "feed" },
    ];
    const sourceSuggestions: TopicSuggestion[] = [
      { topic: "bitcoin price", category: "ANALYSIS", reason: "source" },
    ];

    const merged = mergeAndDedup(feedSuggestions, sourceSuggestions);
    expect(merged.length).toBe(2);
  });

  it("handles empty source suggestions gracefully", () => {
    const feedSuggestions: TopicSuggestion[] = [
      { topic: "bitcoin", category: "ANALYSIS", reason: "feed" },
    ];

    const merged = mergeAndDedup(feedSuggestions, []);
    expect(merged.length).toBe(1);
  });

  it("handles empty feed suggestions gracefully", () => {
    const sourceSuggestions: TopicSuggestion[] = [
      { topic: "bitcoin", category: "ANALYSIS", reason: "source" },
    ];

    const merged = mergeAndDedup([], sourceSuggestions);
    expect(merged.length).toBe(1);
  });
});
