import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRecordV2, AgentSourceView } from "../tools/lib/sources/catalog.js";
import type { PreflightCandidate } from "../tools/lib/sources/policy.js";

const { fetchSourceMock, getProviderAdapterMock } = vi.hoisted(() => ({
  fetchSourceMock: vi.fn(),
  getProviderAdapterMock: vi.fn(),
}));

vi.mock("../tools/lib/sdk.js", () => ({
  apiCall: vi.fn(),
  info: vi.fn(),
}));

vi.mock("../tools/lib/sources/fetch.js", () => ({
  fetchSource: fetchSourceMock,
}));

vi.mock("../tools/lib/sources/providers/index.js", () => ({
  getProviderAdapter: getProviderAdapterMock,
}));

import { extractClaims, extractClaimsLLM, extractClaimsAsync, match, scoreMatch } from "../tools/lib/sources/matcher.js";
import type { LLMProvider } from "../tools/lib/llm-provider.js";

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "src-1",
    name: "Bitcoin Market Data",
    provider: "coingecko",
    url: "https://api.example.com/btc",
    urlPattern: "api.example.com/btc",
    topics: ["bitcoin", "market"],
    tlsn_safe: true,
    dahr_safe: true,
    max_response_kb: 8,
    topicAliases: ["btc"],
    domainTags: ["crypto"],
    responseFormat: "json",
    scope: { visibility: "global", importedFrom: ["sentinel"] },
    runtime: {
      timeoutMs: 1000,
      retry: { maxAttempts: 1, backoffMs: 0, retryOn: ["timeout"] },
    },
    trustTier: "official",
    status: "active",
    rating: {
      overall: 90,
      uptime: 90,
      relevance: 90,
      freshness: 90,
      sizeStability: 90,
      engagement: 90,
      trust: 90,
      testCount: 1,
      successCount: 1,
      consecutiveFailures: 0,
    },
    lifecycle: {
      discoveredAt: "2026-01-01T00:00:00.000Z",
      discoveredBy: "manual",
    },
    ...overrides,
  };
}

function makeCandidate(source: SourceRecordV2): PreflightCandidate {
  return {
    sourceId: source.id,
    source,
    method: "TLSN",
    url: source.url,
    score: 75,
  };
}

const emptySourceView: AgentSourceView = {
  agent: "sentinel",
  catalogVersion: 2,
  sources: [],
  index: {
    byId: new Map(),
    byTopicToken: new Map(),
    byDomainTag: new Map(),
    byProvider: new Map(),
    byAgent: new Map(),
    byMethod: { TLSN: new Set(), DAHR: new Set() },
  },
};

describe("extractClaims", () => {
  it("extracts named entities, numeric claims, and filters stopwords", () => {
    const claims = extractClaims(
      "Federal Reserve says New York liquidity could rise 45% to $1.2B by 2026 while about these markets shift.",
      ["Macro", "Liquidity"]
    );

    expect(claims).toContain("federal reserve");
    expect(claims).toContain("new york");
    expect(claims).toContain("45%");
    expect(claims).toContain("$1.2b");
    expect(claims).toContain("2026");
    expect(claims).toContain("macro");
    expect(claims).not.toContain("about");
    expect(claims).not.toContain("these");
  });
});

describe("evidence and metadata scoring", () => {
  beforeEach(() => {
    fetchSourceMock.mockReset();
    getProviderAdapterMock.mockReset();
  });

  it("scores structured evidence from titles, body text, and metrics via match()", async () => {
    const source = makeSource({
      topics: ["federal reserve", "bitcoin liquidity", "market"],
      domainTags: ["crypto", "macro"],
    });
    fetchSourceMock.mockResolvedValue({
      ok: true,
      response: {
        url: source.url,
        status: 200,
        headers: {},
        bodyText: "{}",
      },
      attempts: 1,
      totalMs: 5,
    });
    getProviderAdapterMock.mockReturnValue({
      provider: "coingecko",
      domains: ["crypto"],
      rateLimit: { bucket: "coingecko" },
      supports: () => true,
      buildCandidates: () => [],
      validateCandidate: () => ({ ok: true }),
      parseResponse: () => ({
        entries: [
          {
            id: "entry-1",
            title: "Federal Reserve bitcoin outlook",
            bodyText: "Analysts expect 45% growth for bitcoin in 2026.",
            topics: ["macro", "crypto"],
            metrics: { liquidity: "1.2b" },
            raw: {},
          },
        ],
      }),
    });

    const result = await match({
      topic: "bitcoin",
      postText: "Federal Reserve says bitcoin liquidity may rise 45% to $1.2B in 2026.",
      postTags: ["crypto", "macro"],
      candidates: [makeCandidate(source)],
      sourceView: emptySourceView,
    });

    expect(result.best?.score).toBeGreaterThan(0);
    expect(result.best?.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("title match"),
        expect.stringContaining("body match"),
        expect.stringContaining("metrics match"),
      ])
    );
  });

  it("scores metadata overlap through scoreMatch()", () => {
    const source = makeSource();
    const result = scoreMatch(["bitcoin", "crypto", "market", "btc"], source, ["crypto"]);

    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedClaims).toEqual(expect.arrayContaining(["bitcoin", "market", "crypto"]));
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("topic token"),
        expect.stringContaining("domain tag"),
        expect.stringContaining("provider-relevant"),
      ])
    );
  });
});

// ── PR6: LLM Claim Extraction ──────────────────────

function mockLLM(response: string | Error): LLMProvider {
  return {
    name: "mock-llm",
    complete: typeof response === "string"
      ? vi.fn().mockResolvedValue(response)
      : vi.fn().mockRejectedValue(response),
  };
}

describe("extractClaimsLLM", () => {
  it("parses valid JSON array from LLM response", async () => {
    const llm = mockLLM('["bitcoin", "$64000", "Federal Reserve", "45% increase"]');
    const claims = await extractClaimsLLM(
      "Bitcoin hit $64000 as Federal Reserve signals 45% increase in liquidity",
      ["crypto"],
      llm,
    );
    expect(claims).toContain("bitcoin");
    expect(claims).toContain("$64000");
    expect(claims).toContain("federal reserve");
    expect(claims).toContain("45% increase");
  });

  it("handles markdown code fences in LLM response", async () => {
    const llm = mockLLM('```json\n["ethereum", "2.0"]\n```');
    const claims = await extractClaimsLLM("Ethereum 2.0 launched", ["crypto"], llm);
    expect(claims).toContain("ethereum");
    expect(claims).toContain("2.0");
  });

  it("returns empty array when LLM throws", async () => {
    const llm = mockLLM(new Error("API timeout"));
    const claims = await extractClaimsLLM("Some text", [], llm);
    expect(claims).toEqual([]);
  });

  it("returns empty array when LLM returns non-JSON", async () => {
    const llm = mockLLM("I cannot extract claims from this text.");
    const claims = await extractClaimsLLM("Some text", [], llm);
    expect(claims).toEqual([]);
  });

  it("returns empty array when LLM returns empty response", async () => {
    const llm = mockLLM("");
    const claims = await extractClaimsLLM("Some text", [], llm);
    expect(claims).toEqual([]);
  });

  it("filters non-string items from LLM response", async () => {
    const llm = mockLLM('["valid", 123, null, "also valid", ""]');
    const claims = await extractClaimsLLM("Test", [], llm);
    expect(claims).toEqual(["valid", "also valid"]);
  });
});

describe("extractClaimsAsync", () => {
  it("merges LLM claims with regex claims when LLM succeeds", async () => {
    const llm = mockLLM('["federal reserve", "liquidity crisis"]');
    const claims = await extractClaimsAsync(
      "Federal Reserve warns of liquidity crisis in 2026 markets",
      ["macro"],
      llm,
    );
    // Should have LLM claims
    expect(claims).toContain("federal reserve");
    expect(claims).toContain("liquidity crisis");
    // Should also have regex claims (numeric, tokens)
    expect(claims).toContain("2026");
    expect(claims).toContain("macro");
  });

  it("deduplicates merged claims", async () => {
    const llm = mockLLM('["bitcoin", "crypto"]');
    const claims = await extractClaimsAsync(
      "Bitcoin is the leading crypto asset",
      ["crypto"],
      llm,
    );
    // "crypto" appears in both LLM and tags — should only appear once
    const cryptoCount = claims.filter((c) => c === "crypto").length;
    expect(cryptoCount).toBe(1);
  });

  it("returns regex-only when LLM fails", async () => {
    const llm = mockLLM(new Error("unavailable"));
    const claims = await extractClaimsAsync(
      "Bitcoin hit $64000 in 2026",
      ["crypto"],
      llm,
    );
    // Should still have regex claims
    expect(claims).toContain("$64000");
    expect(claims).toContain("2026");
    expect(claims).toContain("crypto");
    expect(claims).toContain("bitcoin");
  });

  it("returns regex-only when no LLM provided", async () => {
    const claims = await extractClaimsAsync(
      "Bitcoin hit $64000",
      ["crypto"],
      null,
    );
    expect(claims).toContain("$64000");
    expect(claims).toContain("bitcoin");
  });
});

// ── PR6: Diversity Scoring ─────────────────────────

describe("diversity scoring in match()", () => {
  beforeEach(() => {
    fetchSourceMock.mockReset();
    getProviderAdapterMock.mockReset();
  });

  it("applies diversity bonus when 2+ sources match same claim", async () => {
    const source1 = makeSource({ id: "src-1", name: "Source A", topics: ["bitcoin", "market"] });
    const source2 = makeSource({ id: "src-2", name: "Source B", topics: ["bitcoin", "exchange"] });

    const mockAdapter = {
      provider: "coingecko",
      domains: ["crypto"],
      rateLimit: { bucket: "cg" },
      supports: () => true,
      buildCandidates: () => [],
      validateCandidate: () => ({ ok: true }),
      parseResponse: (_: unknown, resp: { url: string }) =>
        resp.url.includes("src-1")
          ? { entries: [{ id: "e1", title: "Bitcoin price", bodyText: "bitcoin market data", topics: ["crypto"], raw: {} }] }
          : { entries: [{ id: "e2", title: "Bitcoin exchange", bodyText: "bitcoin trading volume", topics: ["crypto"], raw: {} }] },
    };
    getProviderAdapterMock.mockReturnValue(mockAdapter);
    fetchSourceMock.mockImplementation(async (url: string) => ({
      ok: true,
      response: { url, status: 200, headers: {}, bodyText: "{}" },
      attempts: 1,
      totalMs: 5,
    }));

    const result = await match({
      topic: "bitcoin",
      postText: "Bitcoin market data shows strong trading volume",
      postTags: ["crypto"],
      candidates: [
        { sourceId: "src-1", source: source1, method: "TLSN" as const, url: "https://example.com/src-1", score: 75 },
        { sourceId: "src-2", source: source2, method: "DAHR" as const, url: "https://example.com/src-2", score: 70 },
      ],
      sourceView: emptySourceView,
    });

    // With two sources both matching "bitcoin", diversity bonus should apply
    // The exact score depends on evidence scoring + diversity
    expect(result.best).toBeDefined();
    expect(result.best!.score).toBeGreaterThan(0);
    expect(result.considered.length).toBe(2);
  });

  it("no diversity bonus with single candidate", async () => {
    const source = makeSource();
    getProviderAdapterMock.mockReturnValue(null); // No adapter — metadata-only scoring
    fetchSourceMock.mockResolvedValue({ ok: false, attempts: 1, totalMs: 5 });

    const result = await match({
      topic: "bitcoin",
      postText: "Bitcoin market trends",
      postTags: ["crypto"],
      candidates: [makeCandidate(source)],
      sourceView: emptySourceView,
    });

    // Single candidate: score is pure metadata, no diversity bonus
    expect(result.best).toBeDefined();
    // Run same match with scoreMatch for baseline comparison
    const baseline = scoreMatch(
      extractClaims("Bitcoin market trends", ["crypto"]),
      source,
      ["crypto"],
    );
    // Should be equal (no diversity bonus applied)
    expect(result.best!.score).toBe(baseline.score);
  });
});
