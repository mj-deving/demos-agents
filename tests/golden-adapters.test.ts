/**
 * Golden adapter tests — compare hand-written adapter output against
 * declarative YAML spec adapter output for functional equivalence.
 *
 * These tests validate that declarative specs produce equivalent results
 * to hand-written adapters, enabling the removal of hand-written code.
 *
 * Test strategy: structural equivalence (not exact string matching).
 * - buildCandidates: URL path matches, key query params present, operation matches
 * - validateCandidate: ok status matches, rewrite behavior consistent
 * - parseResponse: entry count matches, entry IDs match, key metrics present
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ProviderAdapter,
  BuildCandidatesContext,
  CandidateRequest,
  FetchedResponse,
} from "../tools/lib/sources/providers/types.js";
import type { SourceRecordV2 } from "../tools/lib/sources/catalog.js";

// ── Hand-written adapters ───────────────────────────
import { adapter as hwHnAlgolia } from "../tools/lib/sources/providers/hn-algolia.js";
import { adapter as hwCoingecko } from "../tools/lib/sources/providers/coingecko.js";
import { adapter as hwGithub } from "../tools/lib/sources/providers/github.js";
import { adapter as hwDefillama } from "../tools/lib/sources/providers/defillama.js";
import { adapter as hwArxiv } from "../tools/lib/sources/providers/arxiv.js";
import { adapter as hwWikipedia } from "../tools/lib/sources/providers/wikipedia.js";
import { adapter as hwWorldbank } from "../tools/lib/sources/providers/worldbank.js";
import { adapter as hwPubmed } from "../tools/lib/sources/providers/pubmed.js";
import { adapter as hwBinance } from "../tools/lib/sources/providers/binance.js";
import { adapter as hwKraken } from "../tools/lib/sources/providers/kraken.js";

// ── Declarative adapters ────────────────────────────
import { loadDeclarativeProviderAdaptersSync } from "../tools/lib/sources/providers/declarative-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const specsDir = resolve(__dirname, "../tools/lib/sources/providers/specs");
const declAdapters = loadDeclarativeProviderAdaptersSync({
  specDir: specsDir,
  strictValidation: false,
});

function getDeclAdapter(name: string): ProviderAdapter {
  const a = declAdapters.get(name);
  if (!a) throw new Error(`Declarative adapter "${name}" not found`);
  return a;
}

// ── Helper: minimal SourceRecordV2 ──────────────────
function makeSource(overrides: Partial<SourceRecordV2> & { id: string; provider: string; url: string }): SourceRecordV2 {
  return {
    name: overrides.id,
    urlPattern: overrides.url,
    domainTags: [],
    responseFormat: "json",
    scope: { visibility: "global", importedFrom: [] },
    runtime: { timeoutMs: 10000, retry: { maxAttempts: 1, backoffMs: 0, retryOn: [] } },
    trustTier: "established",
    status: "active" as const,
    rating: { overall: 80, uptime: 1, relevance: 1, freshness: 1, sizeStability: 1, engagement: 1, trust: 1, testCount: 0, successCount: 0, consecutiveFailures: 0 },
    lifecycle: { discoveredAt: "2026-01-01", discoveredBy: "manual" },
    ...overrides,
  } as SourceRecordV2;
}

// ── Helper: build context ───────────────────────────
function makeCtx(source: SourceRecordV2, topic: string, attestation: "TLSN" | "DAHR" = "DAHR", vars: Record<string, string> = {}): BuildCandidatesContext {
  const tokens = topic.toLowerCase().split(/\s+/);
  return { source, topic, tokens, vars, attestation, maxCandidates: 5 };
}

// ── Helper: URL path extraction ─────────────────────
function urlPath(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

function urlParam(url: string, param: string): string | null {
  try { return new URL(url).searchParams.get(param); } catch { return null; }
}

// ── Helper: mock response ───────────────────────────
function makeResponse(bodyText: string, url = "https://example.com", status = 200): FetchedResponse {
  return { url, status, headers: { "content-type": "application/json" }, bodyText };
}

// ════════════════════════════════════════════════════
// HN-ALGOLIA
// ════════════════════════════════════════════════════

describe("golden: hn-algolia", () => {
  const hw = hwHnAlgolia;
  const dc = getDeclAdapter("hn-algolia");

  const source = makeSource({
    id: "hn-search", provider: "hn-algolia",
    url: "https://hn.algolia.com/api/v1/search",
    adapter: { operation: "search" },
  });

  it("buildCandidates: URL contains /search path for both", () => {
    const ctx = makeCtx(source, "artificial intelligence");
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBeGreaterThan(0);
    expect(dcC.length).toBeGreaterThan(0);
    expect(urlPath(hwC[0].url)).toContain("/search");
    expect(urlPath(dcC[0].url)).toContain("/search");
  });

  it("buildCandidates: both include query param", () => {
    const ctx = makeCtx(source, "AI safety");
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(urlParam(hwC[0].url, "query")).toBeTruthy();
    expect(urlParam(dcC[0].url, "query")).toBeTruthy();
  });

  it("buildCandidates: TLSN hitsPerPage=2 for both", () => {
    const ctx = makeCtx(source, "LLMs", "TLSN");
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(urlParam(hwC[0].url, "hitsPerPage")).toBe("2");
    expect(urlParam(dcC[0].url, "hitsPerPage")).toBe("2");
  });

  it("buildCandidates: same operation name", () => {
    const ctx = makeCtx(source, "test");
    expect(hw.buildCandidates(ctx)[0].operation).toBe("search");
    expect(dc.buildCandidates(ctx)[0].operation).toBe("search");
  });

  it("validateCandidate: both rewrite hitsPerPage>2 for TLSN", () => {
    const candidate: CandidateRequest = {
      sourceId: "hn-search", provider: "hn-algolia", operation: "search",
      method: "GET", url: "https://hn.algolia.com/api/v1/search?query=test&hitsPerPage=10",
      attestation: "TLSN", matchHints: ["test"],
    };
    const hwV = hw.validateCandidate(candidate);
    const dcV = dc.validateCandidate(candidate);
    expect(hwV.ok).toBe(true);
    expect(dcV.ok).toBe(true);
    expect(hwV.rewrittenUrl).toBeTruthy();
    expect(dcV.rewrittenUrl).toBeTruthy();
    expect(urlParam(hwV.rewrittenUrl!, "hitsPerPage")).toBe("2");
    expect(urlParam(dcV.rewrittenUrl!, "hitsPerPage")).toBe("2");
  });

  it("parseResponse: same entry count and IDs", () => {
    const fixture = JSON.stringify({
      hits: [
        { objectID: "40001", title: "AI paper", story_text: "Good stuff", points: 100, num_comments: 50, _tags: ["story"], url: "https://example.com", created_at: "2026-01-01T00:00:00Z", author: "jdoe" },
        { objectID: "40002", title: "ML paper", points: 80, num_comments: 30, _tags: ["story"], created_at: "2026-01-02T00:00:00Z" },
      ],
    });
    const resp = makeResponse(fixture, "https://hn.algolia.com/api/v1/search?query=test");
    const hwP = hw.parseResponse(source, resp);
    const dcP = dc.parseResponse(source, resp);
    expect(hwP.entries.length).toBe(dcP.entries.length);
    expect(hwP.entries.map(e => e.id).sort()).toEqual(dcP.entries.map(e => e.id).sort());
  });

  it("parseResponse: both have points metric", () => {
    const fixture = JSON.stringify({
      hits: [{ objectID: "40001", title: "Test", points: 42, num_comments: 5, _tags: [] }],
    });
    const resp = makeResponse(fixture);
    const hwP = hw.parseResponse(source, resp);
    const dcP = dc.parseResponse(source, resp);
    expect(hwP.entries[0].metrics?.points).toBeDefined();
    expect(dcP.entries[0].metrics?.points).toBeDefined();
  });
});

// ════════════════════════════════════════════════════
// COINGECKO
// ════════════════════════════════════════════════════

describe("golden: coingecko", () => {
  const hw = hwCoingecko;
  const dc = getDeclAdapter("coingecko");

  const simplePriceSource = makeSource({
    id: "cg-price", provider: "coingecko",
    url: "https://api.coingecko.com/api/v3/simple/price",
    adapter: { operation: "simple-price" },
  });

  const trendingSource = makeSource({
    id: "cg-trending", provider: "coingecko",
    url: "https://api.coingecko.com/api/v3/search/trending",
    adapter: { operation: "trending" },
  });

  const coinDetailSource = makeSource({
    id: "cg-detail", provider: "coingecko",
    url: "https://api.coingecko.com/api/v3/coins/bitcoin",
    adapter: { operation: "coin-detail" },
  });

  it("buildCandidates: simple-price URL contains /simple/price", () => {
    const ctx = makeCtx(simplePriceSource, "bitcoin", "DAHR", { asset: "bitcoin" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBeGreaterThan(0);
    expect(dcC.length).toBeGreaterThan(0);
    expect(urlPath(hwC[0].url)).toContain("/simple/price");
    expect(urlPath(dcC[0].url)).toContain("/simple/price");
  });

  it("buildCandidates: simple-price includes ids param", () => {
    const ctx = makeCtx(simplePriceSource, "bitcoin", "DAHR", { asset: "bitcoin" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(urlParam(hwC[0].url, "ids")).toBeTruthy();
    expect(urlParam(dcC[0].url, "ids")).toBeTruthy();
  });

  it("buildCandidates: coin-detail returns empty for TLSN in both", () => {
    const ctx = makeCtx(coinDetailSource, "bitcoin", "TLSN", { asset: "bitcoin" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBe(0);
    expect(dcC.length).toBe(0);
  });

  it("buildCandidates: trending URL contains /search/trending", () => {
    const ctx = makeCtx(trendingSource, "crypto");
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC[0].url).toContain("/search/trending");
    expect(dcC[0].url).toContain("/search/trending");
  });

  it("parseResponse: simple-price extracts entries by coin ID", () => {
    const fixture = JSON.stringify({
      bitcoin: { usd: 64000, usd_market_cap: 1200000000000, usd_24h_vol: 25000000000 },
    });
    const resp = makeResponse(fixture);
    const hwP = hw.parseResponse(simplePriceSource, resp);
    const dcP = dc.parseResponse(simplePriceSource, resp);
    expect(hwP.entries.length).toBe(1);
    expect(dcP.entries.length).toBe(1);
    expect(hwP.entries[0].id).toBe("bitcoin");
    expect(dcP.entries[0].id).toBe("bitcoin");
  });

  it("parseResponse: simple-price has price_usd metric", () => {
    const fixture = JSON.stringify({
      bitcoin: { usd: 64000, usd_market_cap: 1200000000000, usd_24h_vol: 25000000000 },
    });
    const resp = makeResponse(fixture);
    const hwP = hw.parseResponse(simplePriceSource, resp);
    const dcP = dc.parseResponse(simplePriceSource, resp);
    expect(hwP.entries[0].metrics?.price_usd).toBeDefined();
    expect(dcP.entries[0].metrics?.price_usd).toBeDefined();
  });

  it("parseResponse: trending extracts from coins[*].item", () => {
    const fixture = JSON.stringify({
      coins: [
        { item: { id: "pepe", name: "Pepe", symbol: "PEPE", market_cap_rank: 25, score: 0 } },
      ],
    });
    const resp = makeResponse(fixture);
    const hwP = hw.parseResponse(trendingSource, resp);
    const dcP = dc.parseResponse(trendingSource, resp);
    expect(hwP.entries.length).toBe(1);
    expect(dcP.entries.length).toBe(1);
    expect(hwP.entries[0].id).toBe("pepe");
    expect(dcP.entries[0].id).toBe("pepe");
  });
});

// ════════════════════════════════════════════════════
// GITHUB
// ════════════════════════════════════════════════════

describe("golden: github", () => {
  const hw = hwGithub;
  const dc = getDeclAdapter("github");

  const searchSource = makeSource({
    id: "gh-search", provider: "github",
    url: "https://api.github.com/search/repositories",
    adapter: { operation: "search-repos" },
  });

  const repoSource = makeSource({
    id: "gh-repo", provider: "github",
    url: "https://api.github.com/repos/{owner}/{repo}",
    adapter: { operation: "repo" },
  });

  it("buildCandidates: search-repos URL contains /search/repositories", () => {
    const ctx = makeCtx(searchSource, "machine learning", "DAHR", { query: "machine learning" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBeGreaterThan(0);
    expect(dcC.length).toBeGreaterThan(0);
    expect(hwC[0].url).toContain("/search/repositories");
    expect(dcC[0].url).toContain("/search/repositories");
  });

  it("buildCandidates: TLSN search-repos per_page=3", () => {
    const ctx = makeCtx(searchSource, "AI", "TLSN", { query: "AI" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(urlParam(hwC[0].url, "per_page")).toBe("3");
    expect(urlParam(dcC[0].url, "per_page")).toBe("3");
  });

  it("validateCandidate: both rewrite per_page>3 for TLSN", () => {
    const candidate: CandidateRequest = {
      sourceId: "gh-search", provider: "github", operation: "search-repos",
      method: "GET", url: "https://api.github.com/search/repositories?q=test&per_page=10",
      attestation: "TLSN", matchHints: ["test"],
    };
    const hwV = hw.validateCandidate(candidate);
    const dcV = dc.validateCandidate(candidate);
    expect(hwV.ok).toBe(true);
    expect(dcV.ok).toBe(true);
    expect(hwV.rewrittenUrl).toBeTruthy();
    expect(dcV.rewrittenUrl).toBeTruthy();
    expect(urlParam(hwV.rewrittenUrl!, "per_page")).toBe("3");
    expect(urlParam(dcV.rewrittenUrl!, "per_page")).toBe("3");
  });

  it("parseResponse: search-repos extracts items array", () => {
    const fixture = JSON.stringify({
      total_count: 100,
      items: [
        { id: 12345, full_name: "user/repo", description: "Cool project", html_url: "https://github.com/user/repo", stargazers_count: 500, forks_count: 50, language: "Python", created_at: "2025-01-01" },
      ],
    });
    const resp = makeResponse(fixture);
    const hwP = hw.parseResponse(searchSource, resp);
    const dcP = dc.parseResponse(searchSource, resp);
    expect(hwP.entries.length).toBe(1);
    expect(dcP.entries.length).toBe(1);
    expect(String(hwP.entries[0].id)).toBe("12345");
    expect(String(dcP.entries[0].id)).toBe("12345");
  });

  it("parseResponse: repo has stars metric", () => {
    const fixture = JSON.stringify({
      id: 99, full_name: "octocat/hello", description: "Hello World", html_url: "https://github.com/octocat/hello",
      stargazers_count: 1000, forks_count: 200, open_issues_count: 5, watchers_count: 900,
      topics: ["hello"], language: "JavaScript", created_at: "2020-01-01",
    });
    const resp = makeResponse(fixture);
    const hwP = hw.parseResponse(repoSource, resp);
    const dcP = dc.parseResponse(repoSource, resp);
    expect(hwP.entries[0].metrics?.stars).toBeDefined();
    expect(dcP.entries[0].metrics?.stars).toBeDefined();
  });
});

// ════════════════════════════════════════════════════
// DEFILLAMA
// ════════════════════════════════════════════════════

describe("golden: defillama", () => {
  const hw = hwDefillama;
  const dc = getDeclAdapter("defillama");

  const tvlSource = makeSource({
    id: "dl-tvl", provider: "defillama",
    url: "https://api.llama.fi/tvl/aave",
    adapter: { operation: "tvl" },
  });

  const protocolSource = makeSource({
    id: "dl-protocol", provider: "defillama",
    url: "https://api.llama.fi/protocol/aave",
    adapter: { operation: "protocol" },
  });

  it("buildCandidates: tvl URL contains /tvl/", () => {
    const ctx = makeCtx(tvlSource, "aave", "DAHR", { asset: "aave" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBeGreaterThan(0);
    expect(dcC.length).toBeGreaterThan(0);
    expect(hwC[0].url).toContain("/tvl/");
    expect(dcC[0].url).toContain("/tvl/");
  });

  it("buildCandidates: protocol returns empty for TLSN in both", () => {
    const ctx = makeCtx(protocolSource, "aave", "TLSN", { asset: "aave" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBe(0);
    expect(dcC.length).toBe(0);
  });

  it("parseResponse: tvl extracts single entry with tvl metric", () => {
    // DefiLlama TVL returns a single number
    const fixture = "1234567890.12";
    const resp = makeResponse(fixture, "https://api.llama.fi/tvl/aave");
    const hwP = hw.parseResponse(tvlSource, resp);
    const dcP = dc.parseResponse(tvlSource, resp);
    expect(hwP.entries.length).toBe(1);
    expect(dcP.entries.length).toBe(1);
    // Both should have some form of tvl in ID
    expect(hwP.entries[0].id).toContain("tvl");
    expect(dcP.entries[0].id).toContain("tvl");
  });
});

// ════════════════════════════════════════════════════
// ARXIV
// ════════════════════════════════════════════════════

describe("golden: arxiv", () => {
  const hw = hwArxiv;
  const dc = getDeclAdapter("arxiv");

  const source = makeSource({
    id: "arxiv-search", provider: "arxiv",
    url: "https://export.arxiv.org/api/query",
    adapter: { operation: "search" },
    responseFormat: "xml",
  });

  it("buildCandidates: returns empty for DAHR in both", () => {
    const ctx = makeCtx(source, "quantum computing", "DAHR");
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBe(0);
    expect(dcC.length).toBe(0);
  });

  it("buildCandidates: TLSN URL has max_results=3", () => {
    const ctx = makeCtx(source, "transformers", "TLSN");
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBeGreaterThan(0);
    expect(dcC.length).toBeGreaterThan(0);
    expect(urlParam(hwC[0].url, "max_results")).toBe("3");
    expect(urlParam(dcC[0].url, "max_results")).toBe("3");
  });

  it("validateCandidate: DAHR rejected in both", () => {
    const candidate: CandidateRequest = {
      sourceId: "arxiv-search", provider: "arxiv", operation: "search",
      method: "GET", url: "https://export.arxiv.org/api/query?search_query=test&max_results=5",
      attestation: "DAHR", matchHints: ["test"],
    };
    const hwV = hw.validateCandidate(candidate);
    const dcV = dc.validateCandidate(candidate);
    expect(hwV.ok).toBe(false);
    expect(dcV.ok).toBe(false);
  });

  it("parseResponse: extracts entries from XML", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
<entry>
<id>http://arxiv.org/abs/2301.12345v1</id>
<title>Test Paper on AI</title>
<summary>This is about AI safety research.</summary>
<published>2026-01-15T00:00:00Z</published>
<category term="cs.AI" />
<author><name>Alice Smith</name></author>
</entry>
<entry>
<id>http://arxiv.org/abs/2301.67890v1</id>
<title>Another Paper</title>
<summary>About neural networks.</summary>
<published>2026-01-14T00:00:00Z</published>
<category term="cs.LG" />
<author><name>Bob Jones</name></author>
</entry>
</feed>`;
    const resp = makeResponse(xml, "https://export.arxiv.org/api/query?search_query=test");
    const hwP = hw.parseResponse(source, resp);
    const dcP = dc.parseResponse(source, resp);
    expect(hwP.entries.length).toBe(2);
    expect(dcP.entries.length).toBe(2);
  });
});

// ════════════════════════════════════════════════════
// WIKIPEDIA
// ════════════════════════════════════════════════════

describe("golden: wikipedia", () => {
  const hw = hwWikipedia;
  const dc = getDeclAdapter("wikipedia");

  const summarySource = makeSource({
    id: "wiki-summary", provider: "wikipedia",
    url: "https://en.wikipedia.org/api/rest_v1/page/summary/Test",
    adapter: { operation: "summary" },
  });

  const searchSource = makeSource({
    id: "wiki-search", provider: "wikipedia",
    url: "https://en.wikipedia.org/w/api.php?action=query&list=search",
    adapter: { operation: "search" },
  });

  it("buildCandidates: summary URL contains /page/summary/", () => {
    const ctx = makeCtx(summarySource, "quantum computing");
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBeGreaterThan(0);
    expect(dcC.length).toBeGreaterThan(0);
    expect(hwC[0].url).toContain("/page/summary/");
    expect(dcC[0].url).toContain("/page/summary/");
  });

  it("buildCandidates: TLSN search has srlimit=2", () => {
    const ctx = makeCtx(searchSource, "AI", "TLSN");
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(urlParam(hwC[0].url, "srlimit")).toBe("2");
    expect(urlParam(dcC[0].url, "srlimit")).toBe("2");
  });

  it("parseResponse: summary extracts single entry", () => {
    const fixture = JSON.stringify({
      pageid: 12345, title: "Quantum computing",
      description: "A type of computation",
      extract: "Quantum computing is the exploitation of collective properties...",
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Quantum_computing" } },
    });
    const resp = makeResponse(fixture);
    const hwP = hw.parseResponse(summarySource, resp);
    const dcP = dc.parseResponse(summarySource, resp);
    expect(hwP.entries.length).toBe(1);
    expect(dcP.entries.length).toBe(1);
    expect(hwP.entries[0].title).toBe("Quantum computing");
    expect(dcP.entries[0].title).toBe("Quantum computing");
  });

  it("parseResponse: search extracts from query.search array", () => {
    const fixture = JSON.stringify({
      query: {
        search: [
          { pageid: 111, title: "AI", snippet: "<span>Artificial intelligence</span>", wordcount: 5000, timestamp: "2026-01-01" },
          { pageid: 222, title: "ML", snippet: "<span>Machine learning</span>", wordcount: 3000, timestamp: "2026-01-02" },
        ],
      },
    });
    const resp = makeResponse(fixture, "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=test");
    const hwP = hw.parseResponse(searchSource, resp);
    const dcP = dc.parseResponse(searchSource, resp);
    expect(hwP.entries.length).toBe(2);
    expect(dcP.entries.length).toBe(2);
  });
});

// ════════════════════════════════════════════════════
// WORLDBANK
// ════════════════════════════════════════════════════

describe("golden: worldbank", () => {
  const hw = hwWorldbank;
  const dc = getDeclAdapter("worldbank");

  const indicatorSource = makeSource({
    id: "wb-gdp", provider: "worldbank",
    url: "https://api.worldbank.org/v2/country/WLD/indicator/NY.GDP.MKTP.CD",
    adapter: { operation: "indicator" },
  });

  it("buildCandidates: indicator URL contains /indicator/", () => {
    const ctx = makeCtx(indicatorSource, "gdp", "DAHR", { indicator: "gdp" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBeGreaterThan(0);
    expect(dcC.length).toBeGreaterThan(0);
    expect(hwC[0].url).toContain("/indicator/");
    expect(dcC[0].url).toContain("/indicator/");
  });

  it("buildCandidates: includes format=json", () => {
    const ctx = makeCtx(indicatorSource, "gdp", "DAHR", { indicator: "gdp" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(urlParam(hwC[0].url, "format")).toBe("json");
    expect(urlParam(dcC[0].url, "format")).toBe("json");
  });

  it("buildCandidates: TLSN has per_page=5", () => {
    const ctx = makeCtx(indicatorSource, "gdp", "TLSN", { indicator: "gdp" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(urlParam(hwC[0].url, "per_page")).toBe("5");
    expect(urlParam(dcC[0].url, "per_page")).toBe("5");
  });

  it("parseResponse: indicator extracts from [meta, data] tuple", () => {
    const fixture = JSON.stringify([
      { page: 1, pages: 1, per_page: 50, total: 1 },
      [{ countryiso3code: "WLD", country: { value: "World" }, indicator: { id: "NY.GDP.MKTP.CD", value: "GDP (current US$)" }, date: "2025", value: 96513077000000 }],
    ]);
    const resp = makeResponse(fixture);
    const hwP = hw.parseResponse(indicatorSource, resp);
    const dcP = dc.parseResponse(indicatorSource, resp);
    expect(hwP.entries.length).toBe(1);
    expect(dcP.entries.length).toBe(1);
    // Both should include value metric
    expect(hwP.entries[0].metrics?.value).toBeDefined();
    expect(dcP.entries[0].metrics?.value).toBeDefined();
  });
});

// ════════════════════════════════════════════════════
// PUBMED
// ════════════════════════════════════════════════════

describe("golden: pubmed", () => {
  const hw = hwPubmed;
  const dc = getDeclAdapter("pubmed");

  const esearchSource = makeSource({
    id: "pm-search", provider: "pubmed",
    url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
    adapter: { operation: "esearch" },
  });

  it("buildCandidates: esearch URL contains /esearch.fcgi", () => {
    const ctx = makeCtx(esearchSource, "CRISPR gene editing");
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBeGreaterThan(0);
    expect(dcC.length).toBeGreaterThan(0);
    expect(hwC[0].url).toContain("/esearch.fcgi");
    expect(dcC[0].url).toContain("/esearch.fcgi");
  });

  it("buildCandidates: TLSN has retmax=3", () => {
    const ctx = makeCtx(esearchSource, "CRISPR", "TLSN");
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(urlParam(hwC[0].url, "retmax")).toBe("3");
    expect(urlParam(dcC[0].url, "retmax")).toBe("3");
  });

  it("validateCandidate: both enforce retmode=json", () => {
    const candidate: CandidateRequest = {
      sourceId: "pm-search", provider: "pubmed", operation: "esearch",
      method: "GET", url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=xml&term=test&retmax=20",
      attestation: "TLSN", matchHints: ["test"],
    };
    const hwV = hw.validateCandidate(candidate);
    const dcV = dc.validateCandidate(candidate);
    expect(hwV.ok).toBe(true);
    expect(dcV.ok).toBe(true);
    // Both should rewrite
    expect(hwV.rewrittenUrl).toBeTruthy();
    expect(dcV.rewrittenUrl).toBeTruthy();
    expect(urlParam(hwV.rewrittenUrl!, "retmode")).toBe("json");
    expect(urlParam(dcV.rewrittenUrl!, "retmode")).toBe("json");
  });

  it("parseResponse: esearch extracts PMIDs from idlist", () => {
    const fixture = JSON.stringify({
      esearchresult: { count: 100, retmax: 3, idlist: ["38001", "38002", "38003"] },
    });
    const resp = makeResponse(fixture);
    const hwP = hw.parseResponse(esearchSource, resp);
    const dcP = dc.parseResponse(esearchSource, resp);
    expect(hwP.entries.length).toBe(3);
    expect(dcP.entries.length).toBe(3);
    expect(hwP.entries.map(e => e.id).sort()).toEqual(["38001", "38002", "38003"]);
    expect(dcP.entries.map(e => e.id).sort()).toEqual(["38001", "38002", "38003"]);
  });
});

// ════════════════════════════════════════════════════
// BINANCE
// ════════════════════════════════════════════════════

describe("golden: binance", () => {
  const hw = hwBinance;
  const dc = getDeclAdapter("binance");

  const tickerSource = makeSource({
    id: "bn-ticker", provider: "binance",
    url: "https://api.binance.com/api/v3/ticker/price",
    adapter: { operation: "ticker-price" },
  });

  it("buildCandidates: ticker-price URL contains /ticker/price", () => {
    const ctx = makeCtx(tickerSource, "BTC", "DAHR", { asset: "bitcoin" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBeGreaterThan(0);
    expect(dcC.length).toBeGreaterThan(0);
    expect(hwC[0].url).toContain("/ticker/price");
    expect(dcC[0].url).toContain("/ticker/price");
  });

  it("buildCandidates: both resolve bitcoin to BTCUSDT", () => {
    const ctx = makeCtx(tickerSource, "BTC", "DAHR", { asset: "bitcoin" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(urlParam(hwC[0].url, "symbol")).toBe("BTCUSDT");
    expect(urlParam(dcC[0].url, "symbol")).toBe("BTCUSDT");
  });

  it("validateCandidate: hand-written rejects missing symbol (declarative passes through)", () => {
    // Known difference: hand-written adapter validates missing symbol param,
    // declarative engine does not (validateCandidate only checks attestation constraints).
    // This is acceptable — buildCandidates always includes symbol, so this case
    // doesn't occur in production.
    const candidate: CandidateRequest = {
      sourceId: "bn-ticker", provider: "binance", operation: "ticker-price",
      method: "GET", url: "https://api.binance.com/api/v3/ticker/price",
      attestation: "DAHR", matchHints: [],
    };
    const hwV = hw.validateCandidate(candidate);
    expect(hwV.ok).toBe(false);
    // Declarative engine is more permissive — documents the difference
    const dcV = dc.validateCandidate(candidate);
    expect(dcV.ok).toBe(true);
  });

  it("parseResponse: ticker-price extracts symbol and price", () => {
    const fixture = JSON.stringify({ symbol: "BTCUSDT", price: "64000.50" });
    const resp = makeResponse(fixture);
    const hwP = hw.parseResponse(tickerSource, resp);
    const dcP = dc.parseResponse(tickerSource, resp);
    expect(hwP.entries.length).toBe(1);
    expect(dcP.entries.length).toBe(1);
    expect(hwP.entries[0].id).toBe("BTCUSDT");
    expect(dcP.entries[0].id).toBe("BTCUSDT");
    expect(hwP.entries[0].metrics?.price).toBeDefined();
    expect(dcP.entries[0].metrics?.price).toBeDefined();
  });
});

// ════════════════════════════════════════════════════
// KRAKEN
// ════════════════════════════════════════════════════

describe("golden: kraken", () => {
  const hw = hwKraken;
  const dc = getDeclAdapter("kraken");

  const tickerSource = makeSource({
    id: "kr-ticker", provider: "kraken",
    url: "https://api.kraken.com/0/public/Ticker",
    adapter: { operation: "ticker" },
  });

  const assetsSource = makeSource({
    id: "kr-assets", provider: "kraken",
    url: "https://api.kraken.com/0/public/Assets",
    adapter: { operation: "assets" },
  });

  it("buildCandidates: ticker URL contains /Ticker", () => {
    const ctx = makeCtx(tickerSource, "BTC", "DAHR", { asset: "bitcoin" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(hwC.length).toBeGreaterThan(0);
    expect(dcC.length).toBeGreaterThan(0);
    expect(hwC[0].url).toContain("/Ticker");
    expect(dcC[0].url).toContain("/Ticker");
  });

  it("buildCandidates: both resolve bitcoin to XXBTZUSD", () => {
    const ctx = makeCtx(tickerSource, "BTC", "DAHR", { asset: "bitcoin" });
    const hwC = hw.buildCandidates(ctx);
    const dcC = dc.buildCandidates(ctx);
    expect(urlParam(hwC[0].url, "pair")).toBe("XXBTZUSD");
    expect(urlParam(dcC[0].url, "pair")).toBe("XXBTZUSD");
  });

  it("validateCandidate: TLSN assets returns not-ok in both", () => {
    const candidate: CandidateRequest = {
      sourceId: "kr-assets", provider: "kraken", operation: "assets",
      method: "GET", url: "https://api.kraken.com/0/public/Assets",
      attestation: "TLSN", matchHints: [],
    };
    const hwV = hw.validateCandidate(candidate);
    const dcV = dc.validateCandidate(candidate);
    expect(hwV.ok).toBe(false);
    expect(dcV.ok).toBe(false);
  });

  it("parseResponse: ticker extracts from result object", () => {
    const fixture = JSON.stringify({
      error: [],
      result: {
        XXBTZUSD: {
          a: ["64000.00", "1", "1.000"],
          b: ["63999.00", "1", "1.000"],
          c: ["64000.50", "0.1"],
          v: ["1000", "5000"],
          p: ["63500.00", "63800.00"],
          t: [200, 1000],
          l: ["62000.00", "61000.00"],
          h: ["65000.00", "66000.00"],
          o: "63000.00",
        },
      },
    });
    const resp = makeResponse(fixture, "https://api.kraken.com/0/public/Ticker?pair=XXBTZUSD");
    const hwP = hw.parseResponse(tickerSource, resp);
    const dcP = dc.parseResponse(tickerSource, resp);
    expect(hwP.entries.length).toBeGreaterThan(0);
    expect(dcP.entries.length).toBeGreaterThan(0);
    expect(hwP.entries[0].id).toBe("XXBTZUSD");
    expect(dcP.entries[0].id).toBe("XXBTZUSD");
  });
});

// ════════════════════════════════════════════════════
// CROSS-PROVIDER: TLSN/DAHR BLOCKING
// ════════════════════════════════════════════════════

describe("golden: attestation blocking consistency", () => {
  const providers = [
    { hw: hwHnAlgolia, name: "hn-algolia", source: makeSource({ id: "hn", provider: "hn-algolia", url: "https://hn.algolia.com/api/v1/search", adapter: { operation: "search" } }) },
    { hw: hwCoingecko, name: "coingecko", source: makeSource({ id: "cg-detail", provider: "coingecko", url: "https://api.coingecko.com/api/v3/coins/bitcoin", adapter: { operation: "coin-detail" } }) },
    { hw: hwDefillama, name: "defillama", source: makeSource({ id: "dl-proto", provider: "defillama", url: "https://api.llama.fi/protocol/aave", adapter: { operation: "protocol" } }) },
    { hw: hwArxiv, name: "arxiv", source: makeSource({ id: "arxiv", provider: "arxiv", url: "https://export.arxiv.org/api/query", adapter: { operation: "search" }, responseFormat: "xml" }) },
  ];

  for (const { hw, name, source } of providers) {
    it(`${name}: TLSN/DAHR blocking matches between adapters`, () => {
      const dc = getDeclAdapter(name);
      for (const attestation of ["TLSN", "DAHR"] as const) {
        const ctx = makeCtx(source, "test", attestation, { asset: "test", query: "test" });
        const hwC = hw.buildCandidates(ctx);
        const dcC = dc.buildCandidates(ctx);
        // If one returns empty, the other should too (blocked)
        if (hwC.length === 0) {
          expect(dcC.length).toBe(0);
        }
        if (dcC.length === 0) {
          expect(hwC.length).toBe(0);
        }
      }
    });
  }
});
