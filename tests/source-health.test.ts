import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SourceRecordV2 } from "../tools/lib/sources/catalog.js";
import type { FetchedResponse, ProviderAdapter, ParsedAdapterResponse, EvidenceEntry } from "../tools/lib/sources/providers/types.js";

// ── Mocks ────────────────────────────────────────────

const fetchSourceMock = vi.hoisted(() => vi.fn());
const getProviderAdapterMock = vi.hoisted(() => vi.fn());

vi.mock("../tools/lib/sources/fetch.js", () => ({
  fetchSource: fetchSourceMock,
}));

vi.mock("../tools/lib/sources/providers/index.js", () => ({
  getProviderAdapter: getProviderAdapterMock,
}));

vi.mock("../tools/lib/sdk.js", () => ({
  apiCall: vi.fn(),
  info: vi.fn(),
}));

// Import after mocks
import {
  testSource,
  resolveTestUrl,
  filterSources,
  type SourceTestResult,
  type SourceTestStatus,
  DEFAULT_TEST_VARS,
} from "../tools/lib/sources/health.js";

// ── Fixtures ─────────────────────────────────────────

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "coingecko-bitcoin",
    name: "CoinGecko Bitcoin",
    provider: "coingecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids={asset}&vs_currencies=usd",
    urlPattern: "api.coingecko.com",
    topics: ["bitcoin", "crypto"],
    tlsn_safe: true,
    dahr_safe: true,
    max_response_kb: 8,
    topicAliases: ["btc", "bitcoin"],
    domainTags: ["crypto"],
    responseFormat: "json",
    scope: { visibility: "global", importedFrom: ["sentinel"] },
    runtime: {
      timeoutMs: 5000,
      retry: { maxAttempts: 2, backoffMs: 500, retryOn: ["timeout"] },
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

function makeAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    provider: "coingecko",
    domains: ["crypto"],
    rateLimit: { bucket: "coingecko", maxPerMinute: 10 },
    supports: vi.fn().mockReturnValue(true),
    buildCandidates: vi.fn().mockReturnValue([
      {
        sourceId: "coingecko-bitcoin",
        provider: "coingecko",
        operation: "simple-price",
        method: "GET",
        url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        attestation: "TLSN",
        matchHints: ["bitcoin"],
      },
    ]),
    validateCandidate: vi.fn().mockReturnValue({ ok: true }),
    parseResponse: vi.fn().mockReturnValue({
      entries: [
        {
          id: "btc-1",
          title: "Bitcoin",
          bodyText: "Bitcoin price data",
          topics: ["bitcoin"],
          raw: {},
        },
      ],
    } as ParsedAdapterResponse),
    ...overrides,
  };
}

function makeResponse(): FetchedResponse {
  return {
    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    status: 200,
    headers: { "content-type": "application/json" },
    bodyText: '{"bitcoin":{"usd":64000}}',
  };
}

// ── testSource ───────────────────────────────────────

describe("testSource", () => {
  beforeEach(() => {
    fetchSourceMock.mockReset();
    getProviderAdapterMock.mockReset();
  });

  it("returns OK when fetch+parse succeed with entries", async () => {
    const source = makeSource();
    const adapter = makeAdapter();
    getProviderAdapterMock.mockReturnValue(adapter);
    fetchSourceMock.mockResolvedValue({
      ok: true,
      response: makeResponse(),
      attempts: 1,
      totalMs: 230,
    });

    const result = await testSource(source);

    expect(result.status).toBe("OK");
    expect(result.entryCount).toBe(1);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.sampleTitles).toContain("Bitcoin");
    expect(result.error).toBeNull();
  });

  it("returns FETCH_FAILED when fetchSource throws", async () => {
    const source = makeSource();
    const adapter = makeAdapter();
    getProviderAdapterMock.mockReturnValue(adapter);
    fetchSourceMock.mockRejectedValue(new Error("Connection refused"));

    const result = await testSource(source);

    expect(result.status).toBe("FETCH_FAILED");
    expect(result.error).toContain("Connection refused");
  });

  it("returns FETCH_FAILED when fetchSource returns ok=false", async () => {
    const source = makeSource();
    const adapter = makeAdapter();
    getProviderAdapterMock.mockReturnValue(adapter);
    fetchSourceMock.mockResolvedValue({
      ok: false,
      error: "HTTP 502",
      attempts: 2,
      totalMs: 1200,
    });

    const result = await testSource(source);

    expect(result.status).toBe("FETCH_FAILED");
    expect(result.error).toContain("502");
  });

  it("returns PARSE_FAILED when adapter.parseResponse throws", async () => {
    const source = makeSource();
    const adapter = makeAdapter({
      parseResponse: vi.fn().mockImplementation(() => {
        throw new Error("Unexpected JSON structure");
      }),
    });
    getProviderAdapterMock.mockReturnValue(adapter);
    fetchSourceMock.mockResolvedValue({
      ok: true,
      response: makeResponse(),
      attempts: 1,
      totalMs: 200,
    });

    const result = await testSource(source);

    expect(result.status).toBe("PARSE_FAILED");
    expect(result.error).toContain("Unexpected JSON structure");
  });

  it("returns EMPTY when adapter returns 0 entries", async () => {
    const source = makeSource();
    const adapter = makeAdapter({
      parseResponse: vi.fn().mockReturnValue({ entries: [] }),
    });
    getProviderAdapterMock.mockReturnValue(adapter);
    fetchSourceMock.mockResolvedValue({
      ok: true,
      response: makeResponse(),
      attempts: 1,
      totalMs: 150,
    });

    const result = await testSource(source);

    expect(result.status).toBe("EMPTY");
    expect(result.entryCount).toBe(0);
  });

  it("returns NO_ADAPTER when getProviderAdapter returns null", async () => {
    const source = makeSource();
    getProviderAdapterMock.mockReturnValue(null);

    const result = await testSource(source);

    expect(result.status).toBe("NO_ADAPTER");
    expect(result.error).toContain("No adapter");
    expect(fetchSourceMock).not.toHaveBeenCalled();
  });

  it("records latency in milliseconds", async () => {
    const source = makeSource();
    const adapter = makeAdapter();
    getProviderAdapterMock.mockReturnValue(adapter);
    fetchSourceMock.mockResolvedValue({
      ok: true,
      response: makeResponse(),
      attempts: 1,
      totalMs: 350,
    });

    const result = await testSource(source);

    expect(result.latencyMs).toBe(350);
  });

  it("includes sample titles (max 3) from parsed entries", async () => {
    const entries: EvidenceEntry[] = [
      { id: "1", title: "Alpha", bodyText: "", topics: [], raw: {} },
      { id: "2", title: "Beta", bodyText: "", topics: [], raw: {} },
      { id: "3", title: "Gamma", bodyText: "", topics: [], raw: {} },
      { id: "4", title: "Delta", bodyText: "", topics: [], raw: {} },
    ];
    const source = makeSource();
    const adapter = makeAdapter({
      parseResponse: vi.fn().mockReturnValue({ entries }),
    });
    getProviderAdapterMock.mockReturnValue(adapter);
    fetchSourceMock.mockResolvedValue({
      ok: true,
      response: makeResponse(),
      attempts: 1,
      totalMs: 100,
    });

    const result = await testSource(source);

    expect(result.sampleTitles).toHaveLength(3);
    expect(result.sampleTitles).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("returns UNRESOLVED_VARS when URL has unresolved template variables", async () => {
    const source = makeSource({
      url: "https://api.example.com/{unknown_var}/data",
    });
    // Adapter returns no candidates, so it falls back to direct URL resolution
    const adapter = makeAdapter({
      buildCandidates: vi.fn().mockReturnValue([]),
    });
    getProviderAdapterMock.mockReturnValue(adapter);

    const result = await testSource(source);

    expect(result.status).toBe("UNRESOLVED_VARS");
    expect(result.error).toContain("unknown_var");
  });
});

// ── resolveTestUrl ───────────────────────────────────

describe("resolveTestUrl", () => {
  it("replaces template variables with defaults", () => {
    const url = "https://api.example.com/price?ids={asset}&vs={currency}";
    const resolved = resolveTestUrl(url, {});

    expect(resolved).not.toContain("{asset}");
    expect(resolved).toContain(DEFAULT_TEST_VARS.asset);
  });

  it("uses source topicAliases for query variables", () => {
    const url = "https://api.example.com/search?q={query}";
    const source = makeSource({ topicAliases: ["ethereum"] });
    const resolved = resolveTestUrl(url, {}, source);

    expect(resolved).toContain("ethereum");
  });

  it("accepts custom variable overrides", () => {
    const url = "https://api.example.com/price?ids={asset}";
    const resolved = resolveTestUrl(url, { asset: "ethereum" });

    expect(resolved).toContain("ethereum");
    expect(resolved).not.toContain("{asset}");
  });

  it("returns unresolved variables for unknown placeholders", () => {
    const url = "https://api.example.com/{totally_unknown}";
    const resolved = resolveTestUrl(url, {});

    expect(resolved).toContain("{totally_unknown}");
  });
});

// ── filterSources ────────────────────────────────────

describe("filterSources", () => {
  const sources = [
    makeSource({ id: "coingecko-btc", provider: "coingecko", status: "active" }),
    makeSource({ id: "coingecko-eth", provider: "coingecko", status: "active" }),
    makeSource({ id: "hn-top", provider: "hn-algolia", status: "active" }),
    makeSource({ id: "old-api", provider: "legacy", status: "quarantined" }),
  ];

  it("filters by sourceId returns single match", () => {
    const result = filterSources(sources, { sourceId: "coingecko-btc" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("coingecko-btc");
  });

  it("filters by provider returns all matching sources", () => {
    const result = filterSources(sources, { provider: "coingecko" });
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.provider === "coingecko")).toBe(true);
  });

  it("filters quarantined only when flag set", () => {
    const result = filterSources(sources, { quarantined: true });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("quarantined");
  });

  it("filters active only by default (no quarantined flag)", () => {
    const result = filterSources(sources, {});
    expect(result).toHaveLength(3);
    expect(result.every((s) => s.status === "active")).toBe(true);
  });

  it("returns empty array when no match", () => {
    const result = filterSources(sources, { sourceId: "nonexistent" });
    expect(result).toHaveLength(0);
  });
});
