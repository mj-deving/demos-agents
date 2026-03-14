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

import { extractClaims, match, scoreMatch } from "../tools/lib/sources/matcher.js";

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
