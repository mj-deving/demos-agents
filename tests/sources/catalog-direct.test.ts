/**
 * Direct tests for src/lib/sources/catalog.ts — source catalog registry.
 *
 * Tests:
 *   - loadCatalog: valid loading, empty catalog, invalid/corrupt data
 *   - buildSourceIndex: index construction, domain tag filtering, provider grouping
 *   - Source filtering by domain tags
 *   - Rating/health scoring structures
 *   - tokenizeTopic, sourceTopicTokens
 *   - normalizeUrlPattern, inferProvider, generateSourceId
 *   - normalizeSourceRecord (V1 → V2 conversion)
 *   - isValidSourceRecord validation
 *   - loadYamlRegistry
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SourceRecordV2, SourceCatalogFileV2 } from "../../src/lib/sources/catalog.js";

// ── Helpers ─────────────────────────────────────────

/** Build a minimal valid V2 source record for testing. */
function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "test-00000001",
    name: "Test Source",
    provider: "generic",
    url: "https://example.com/api/data",
    urlPattern: "example.com/api/data",
    topics: ["testing"],
    domainTags: ["testing"],
    responseFormat: "json",
    scope: {
      visibility: "global",
      importedFrom: ["sentinel"],
    },
    runtime: {
      timeoutMs: 8000,
      retry: { maxAttempts: 2, backoffMs: 1000, retryOn: ["timeout", "5xx"] },
    },
    trustTier: "established",
    status: "active",
    rating: {
      overall: 75,
      uptime: 80,
      relevance: 70,
      freshness: 65,
      sizeStability: 70,
      engagement: 60,
      trust: 80,
      testCount: 10,
      successCount: 9,
      consecutiveFailures: 0,
    },
    lifecycle: {
      discoveredAt: "2025-01-01T00:00:00Z",
      discoveredBy: "manual",
    },
    ...overrides,
  };
}

/** Write a catalog JSON file to a temp directory. Returns the file path. */
function writeTempCatalog(sources: SourceRecordV2[], dir?: string): string {
  const tempDir = dir || mkdtempSync(join(tmpdir(), "catalog-test-"));
  const catalogPath = join(tempDir, "catalog.json");
  const catalog: SourceCatalogFileV2 = {
    version: 2,
    generatedAt: new Date().toISOString(),
    aliasesVersion: 1,
    sources,
  };
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  return catalogPath;
}

// ── Tests ───────────────────────────────────────────

describe("catalog — loadCatalog", () => {
  it("loads a valid catalog with sources", async () => {
    const { loadCatalog } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource();
    const path = writeTempCatalog([source]);

    const catalog = loadCatalog(path);
    expect(catalog).not.toBeNull();
    expect(catalog!.version).toBe(2);
    expect(catalog!.sources).toHaveLength(1);
    expect(catalog!.sources[0].id).toBe("test-00000001");
    expect(catalog!.sources[0].name).toBe("Test Source");
  });

  it("loads an empty catalog successfully", async () => {
    const { loadCatalog } = await import("../../src/lib/sources/catalog.js");
    const path = writeTempCatalog([]);

    const catalog = loadCatalog(path);
    expect(catalog).not.toBeNull();
    expect(catalog!.sources).toHaveLength(0);
  });

  it("returns null for nonexistent file", async () => {
    const { loadCatalog } = await import("../../src/lib/sources/catalog.js");
    const result = loadCatalog("/nonexistent/path/catalog.json");
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    const { loadCatalog } = await import("../../src/lib/sources/catalog.js");
    const tempDir = mkdtempSync(join(tmpdir(), "catalog-bad-"));
    const path = join(tempDir, "catalog.json");
    writeFileSync(path, "not valid json {{{");

    const result = loadCatalog(path);
    expect(result).toBeNull();
  });

  it("returns null for wrong version number", async () => {
    const { loadCatalog } = await import("../../src/lib/sources/catalog.js");
    const tempDir = mkdtempSync(join(tmpdir(), "catalog-v1-"));
    const path = join(tempDir, "catalog.json");
    writeFileSync(path, JSON.stringify({ version: 1, sources: [] }));

    const result = loadCatalog(path);
    expect(result).toBeNull();
  });

  it("returns null for missing sources array", async () => {
    const { loadCatalog } = await import("../../src/lib/sources/catalog.js");
    const tempDir = mkdtempSync(join(tmpdir(), "catalog-nosrc-"));
    const path = join(tempDir, "catalog.json");
    writeFileSync(path, JSON.stringify({ version: 2 }));

    const result = loadCatalog(path);
    expect(result).toBeNull();
  });

  it("filters out invalid source records", async () => {
    const { loadCatalog } = await import("../../src/lib/sources/catalog.js");
    const valid = makeSource({ id: "valid-1" });
    const tempDir = mkdtempSync(join(tmpdir(), "catalog-mixed-"));
    const path = join(tempDir, "catalog.json");
    // One valid, one invalid (missing required fields)
    writeFileSync(path, JSON.stringify({
      version: 2,
      generatedAt: new Date().toISOString(),
      aliasesVersion: 1,
      sources: [valid, { id: "bad", name: "Bad" }],
    }));

    const catalog = loadCatalog(path);
    // 50% valid — exactly at the threshold, should succeed
    expect(catalog).not.toBeNull();
    expect(catalog!.sources).toHaveLength(1);
    expect(catalog!.sources[0].id).toBe("valid-1");
  });

  it("returns null when >50% of records are invalid (corrupt catalog)", async () => {
    const { loadCatalog } = await import("../../src/lib/sources/catalog.js");
    const tempDir = mkdtempSync(join(tmpdir(), "catalog-corrupt-"));
    const path = join(tempDir, "catalog.json");
    // 3 invalid, 1 valid — 75% rejected
    const valid = makeSource();
    writeFileSync(path, JSON.stringify({
      version: 2,
      generatedAt: new Date().toISOString(),
      aliasesVersion: 1,
      sources: [
        { id: "bad1" },
        { id: "bad2" },
        { id: "bad3" },
        valid,
      ],
    }));

    const result = loadCatalog(path);
    expect(result).toBeNull();
  });
});

describe("catalog — buildSourceIndex", () => {
  it("indexes sources by ID", async () => {
    const { buildSourceIndex } = await import("../../src/lib/sources/catalog.js");
    const s1 = makeSource({ id: "src-1", name: "Source 1" });
    const s2 = makeSource({ id: "src-2", name: "Source 2" });

    const index = buildSourceIndex([s1, s2]);
    expect(index.byId.size).toBe(2);
    expect(index.byId.get("src-1")?.name).toBe("Source 1");
    expect(index.byId.get("src-2")?.name).toBe("Source 2");
  });

  it("indexes sources by provider", async () => {
    const { buildSourceIndex } = await import("../../src/lib/sources/catalog.js");
    const s1 = makeSource({ id: "s1", provider: "coingecko" });
    const s2 = makeSource({ id: "s2", provider: "coingecko" });
    const s3 = makeSource({ id: "s3", provider: "github" });

    const index = buildSourceIndex([s1, s2, s3]);
    expect(index.byProvider.get("coingecko")?.size).toBe(2);
    expect(index.byProvider.get("github")?.size).toBe(1);
  });

  it("indexes sources by domain tags", async () => {
    const { buildSourceIndex } = await import("../../src/lib/sources/catalog.js");
    const s1 = makeSource({ id: "s1", domainTags: ["defi", "crypto"] });
    const s2 = makeSource({ id: "s2", domainTags: ["crypto", "markets"] });

    const index = buildSourceIndex([s1, s2]);
    expect(index.byDomainTag.get("crypto")?.size).toBe(2);
    expect(index.byDomainTag.get("defi")?.size).toBe(1);
    expect(index.byDomainTag.get("markets")?.size).toBe(1);
  });

  it("indexes global sources as visible to all agents", async () => {
    const { buildSourceIndex } = await import("../../src/lib/sources/catalog.js");
    const global = makeSource({
      id: "global-1",
      scope: { visibility: "global", importedFrom: ["sentinel"] },
    });

    const index = buildSourceIndex([global]);
    expect(index.byAgent.get("sentinel")?.has("global-1")).toBe(true);
    expect(index.byAgent.get("crawler")?.has("global-1")).toBe(true);
    expect(index.byAgent.get("pioneer")?.has("global-1")).toBe(true);
  });

  it("indexes scoped sources only for specified agents", async () => {
    const { buildSourceIndex } = await import("../../src/lib/sources/catalog.js");
    const scoped = makeSource({
      id: "scoped-1",
      scope: { visibility: "scoped", agents: ["sentinel"], importedFrom: ["sentinel"] },
    });

    const index = buildSourceIndex([scoped]);
    expect(index.byAgent.get("sentinel")?.has("scoped-1")).toBe(true);
    expect(index.byAgent.get("crawler")?.has("scoped-1")).toBeFalsy();
  });

  it("indexes TLSN and DAHR safe sources", async () => {
    const { buildSourceIndex } = await import("../../src/lib/sources/catalog.js");
    const tlsn = makeSource({ id: "tlsn-1", tlsn_safe: true, dahr_safe: false });
    const dahr = makeSource({ id: "dahr-1", tlsn_safe: false, dahr_safe: true });
    const both = makeSource({ id: "both-1", tlsn_safe: true, dahr_safe: true });

    const index = buildSourceIndex([tlsn, dahr, both]);
    expect(index.byMethod.TLSN.size).toBe(2);
    expect(index.byMethod.DAHR.size).toBe(2);
    expect(index.byMethod.TLSN.has("tlsn-1")).toBe(true);
    expect(index.byMethod.TLSN.has("both-1")).toBe(true);
    expect(index.byMethod.DAHR.has("dahr-1")).toBe(true);
    expect(index.byMethod.DAHR.has("both-1")).toBe(true);
  });

  it("indexes topic tokens from topics and aliases", async () => {
    const { buildSourceIndex } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource({
      id: "tok-1",
      topics: ["Decentralized Finance"],
      topicAliases: ["DeFi protocols"],
    });

    const index = buildSourceIndex([source]);
    expect(index.byTopicToken.get("decentralized")?.has("tok-1")).toBe(true);
    expect(index.byTopicToken.get("finance")?.has("tok-1")).toBe(true);
    expect(index.byTopicToken.get("defi")?.has("tok-1")).toBe(true);
    expect(index.byTopicToken.get("protocols")?.has("tok-1")).toBe(true);
  });

  it("returns empty index for empty sources array", async () => {
    const { buildSourceIndex } = await import("../../src/lib/sources/catalog.js");
    const index = buildSourceIndex([]);

    expect(index.byId.size).toBe(0);
    expect(index.byTopicToken.size).toBe(0);
    expect(index.byDomainTag.size).toBe(0);
    expect(index.byProvider.size).toBe(0);
    expect(index.byAgent.size).toBe(0);
    expect(index.byMethod.TLSN.size).toBe(0);
    expect(index.byMethod.DAHR.size).toBe(0);
  });
});

describe("catalog — tokenizeTopic", () => {
  it("splits on non-alphanumeric and lowercases", async () => {
    const { tokenizeTopic } = await import("../../src/lib/sources/catalog.js");
    const tokens = tokenizeTopic("Decentralized Finance & DeFi");

    expect(tokens.has("decentralized")).toBe(true);
    expect(tokens.has("finance")).toBe(true);
    expect(tokens.has("defi")).toBe(true);
  });

  it("filters out single-character tokens", async () => {
    const { tokenizeTopic } = await import("../../src/lib/sources/catalog.js");
    const tokens = tokenizeTopic("A big test");

    expect(tokens.has("a")).toBe(false);
    expect(tokens.has("big")).toBe(true);
    expect(tokens.has("test")).toBe(true);
  });

  it("returns empty set for empty string", async () => {
    const { tokenizeTopic } = await import("../../src/lib/sources/catalog.js");
    const tokens = tokenizeTopic("");
    expect(tokens.size).toBe(0);
  });
});

describe("catalog — sourceTopicTokens", () => {
  it("extracts tokens from V2 source topics", async () => {
    const { sourceTopicTokens } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource({ topics: ["blockchain security", "smart contracts"] });

    const tokens = sourceTopicTokens(source);
    expect(tokens.has("blockchain")).toBe(true);
    expect(tokens.has("security")).toBe(true);
    expect(tokens.has("smart")).toBe(true);
    expect(tokens.has("contracts")).toBe(true);
  });

  it("returns empty set when no topics", async () => {
    const { sourceTopicTokens } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource({ topics: undefined });

    const tokens = sourceTopicTokens(source);
    expect(tokens.size).toBe(0);
  });

  it("works with V1 source records", async () => {
    const { sourceTopicTokens } = await import("../../src/lib/sources/catalog.js");
    const v1 = { name: "Test", url: "https://example.com", topics: ["AI research"] };

    const tokens = sourceTopicTokens(v1 as any);
    expect(tokens.has("ai")).toBe(true);
    expect(tokens.has("research")).toBe(true);
  });
});

describe("catalog — normalizeUrlPattern", () => {
  it("strips protocol and trailing slashes", async () => {
    const { normalizeUrlPattern } = await import("../../src/lib/sources/catalog.js");
    const result = normalizeUrlPattern("https://api.example.com/v1/data/");
    expect(result).toBe("api.example.com/v1/data");
  });

  it("sorts query parameters", async () => {
    const { normalizeUrlPattern } = await import("../../src/lib/sources/catalog.js");
    const result = normalizeUrlPattern("https://api.example.com/data?z=1&a=2");
    expect(result).toBe("api.example.com/data?a=2&z=1");
  });

  it("replaces template variables before normalization", async () => {
    const { normalizeUrlPattern } = await import("../../src/lib/sources/catalog.js");
    const result = normalizeUrlPattern("https://api.example.com/coins/{id}/market");
    // Template vars get URL-encoded by the URL constructor, but {id} should not appear
    expect(result).not.toContain("{id}");
    // The normalized result should contain the encoded VAR placeholder
    expect(result).toContain("%7BVAR%7D");
    expect(result).toContain("api.example.com");
  });

  it("falls back to lowercase for invalid URLs", async () => {
    const { normalizeUrlPattern } = await import("../../src/lib/sources/catalog.js");
    const result = normalizeUrlPattern("not a url at all ::::");
    expect(result).toBe("not a url at all ::::");
  });
});

describe("catalog — inferProvider", () => {
  it("detects coingecko", async () => {
    const { inferProvider } = await import("../../src/lib/sources/catalog.js");
    expect(inferProvider("https://api.coingecko.com/api/v3/coins")).toBe("coingecko");
  });

  it("detects github", async () => {
    const { inferProvider } = await import("../../src/lib/sources/catalog.js");
    expect(inferProvider("https://api.github.com/repos/foo/bar")).toBe("github");
  });

  it("detects arxiv", async () => {
    const { inferProvider } = await import("../../src/lib/sources/catalog.js");
    expect(inferProvider("https://export.arxiv.org/api/query?search_query=ai")).toBe("arxiv");
  });

  it("returns generic for unknown URLs", async () => {
    const { inferProvider } = await import("../../src/lib/sources/catalog.js");
    expect(inferProvider("https://random-api.example.com/data")).toBe("generic");
  });
});

describe("catalog — generateSourceId", () => {
  it("produces deterministic IDs", async () => {
    const { generateSourceId } = await import("../../src/lib/sources/catalog.js");
    const id1 = generateSourceId("coingecko", "api.coingecko.com/api/v3/coins");
    const id2 = generateSourceId("coingecko", "api.coingecko.com/api/v3/coins");
    expect(id1).toBe(id2);
  });

  it("produces different IDs for different inputs", async () => {
    const { generateSourceId } = await import("../../src/lib/sources/catalog.js");
    const id1 = generateSourceId("coingecko", "api.coingecko.com/api/v3/coins");
    const id2 = generateSourceId("github", "api.github.com/repos");
    expect(id1).not.toBe(id2);
  });

  it("includes provider prefix in ID", async () => {
    const { generateSourceId } = await import("../../src/lib/sources/catalog.js");
    const id = generateSourceId("coingecko", "api.coingecko.com/api/v3/coins");
    expect(id.startsWith("coingecko-")).toBe(true);
  });
});

describe("catalog — normalizeSourceRecord (V1 to V2)", () => {
  it("converts a V1 record to V2 format", async () => {
    const { normalizeSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const v1 = {
      name: "CoinGecko Markets",
      url: "https://api.coingecko.com/api/v3/coins/markets",
      topics: ["crypto", "markets"],
      tlsn_safe: true,
      dahr_safe: true,
    };

    const v2 = normalizeSourceRecord(v1);
    expect(v2.name).toBe("CoinGecko Markets");
    expect(v2.provider).toBe("coingecko");
    expect(v2.url).toBe(v1.url);
    expect(v2.id).toMatch(/^coingecko-/);
    expect(v2.status).toBe("active");
    expect(v2.trustTier).toBe("established");
    expect(v2.scope.visibility).toBe("scoped");
    expect(v2.scope.agents).toEqual(["sentinel"]);
    expect(v2.lifecycle.discoveredBy).toBe("import");
    expect(v2.domainTags).toEqual(["crypto", "markets"]);
    expect(v2.responseFormat).toBe("json");
  });

  it("uses specified agent for scope", async () => {
    const { normalizeSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const v1 = { name: "Test", url: "https://example.com/data" };

    const v2 = normalizeSourceRecord(v1, "crawler");
    expect(v2.scope.agents).toEqual(["crawler"]);
    expect(v2.scope.importedFrom).toEqual(["crawler"]);
  });

  it("uses provided timestamp for lifecycle", async () => {
    const { normalizeSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const v1 = { name: "Test", url: "https://example.com/data" };
    const ts = "2025-06-01T00:00:00Z";

    const v2 = normalizeSourceRecord(v1, "sentinel", ts);
    expect(v2.lifecycle.discoveredAt).toBe(ts);
  });

  it("infers XML format for arxiv URLs", async () => {
    const { normalizeSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const v1 = { name: "ArXiv Search", url: "https://export.arxiv.org/api/query?search_query=ai" };

    const v2 = normalizeSourceRecord(v1);
    expect(v2.responseFormat).toBe("xml");
  });

  it("initializes rating with neutral scores", async () => {
    const { normalizeSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const v1 = { name: "Test", url: "https://example.com/api" };

    const v2 = normalizeSourceRecord(v1);
    expect(v2.rating.overall).toBe(50);
    expect(v2.rating.uptime).toBe(50);
    expect(v2.rating.testCount).toBe(0);
    expect(v2.rating.successCount).toBe(0);
    expect(v2.rating.consecutiveFailures).toBe(0);
  });
});

describe("catalog — isValidSourceRecord", () => {
  it("accepts a well-formed V2 record", async () => {
    const { isValidSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource();
    expect(isValidSourceRecord(source)).toBe(true);
  });

  it("rejects null", async () => {
    const { isValidSourceRecord } = await import("../../src/lib/sources/catalog.js");
    expect(isValidSourceRecord(null)).toBe(false);
  });

  it("rejects a record missing required fields", async () => {
    const { isValidSourceRecord } = await import("../../src/lib/sources/catalog.js");
    expect(isValidSourceRecord({ id: "test" })).toBe(false);
  });

  it("rejects a record with invalid status", async () => {
    const { isValidSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource({ status: "invalid" as any });
    expect(isValidSourceRecord(source)).toBe(false);
  });

  it("rejects a record with invalid trustTier", async () => {
    const { isValidSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource({ trustTier: "fake" as any });
    expect(isValidSourceRecord(source)).toBe(false);
  });

  it("rejects a record with invalid scope", async () => {
    const { isValidSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource();
    (source as any).scope = { visibility: "invalid" };
    expect(isValidSourceRecord(source)).toBe(false);
  });

  it("rejects a record with invalid runtime", async () => {
    const { isValidSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource();
    (source as any).runtime = { timeoutMs: "not a number" };
    expect(isValidSourceRecord(source)).toBe(false);
  });

  it("accepts a record with optional adapter", async () => {
    const { isValidSourceRecord } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource();
    source.adapter = { operation: "search" };
    expect(isValidSourceRecord(source)).toBe(true);
  });
});

describe("catalog — loadYamlRegistry", () => {
  it("loads valid YAML sources", async () => {
    const { loadYamlRegistry } = await import("../../src/lib/sources/catalog.js");
    const tempDir = mkdtempSync(join(tmpdir(), "yaml-reg-"));
    const path = join(tempDir, "sources.yaml");
    writeFileSync(path, `
sources:
  - name: Test Source
    url: https://example.com/api
    topics: [testing]
  - name: Another Source
    url: https://other.com/data
`);

    const sources = loadYamlRegistry(path);
    expect(sources).toHaveLength(2);
    expect(sources[0].name).toBe("Test Source");
    expect(sources[0].url).toBe("https://example.com/api");
    expect(sources[1].name).toBe("Another Source");
  });

  it("returns empty array for nonexistent file", async () => {
    const { loadYamlRegistry } = await import("../../src/lib/sources/catalog.js");
    const result = loadYamlRegistry("/nonexistent/sources.yaml");
    expect(result).toEqual([]);
  });

  it("returns empty array for invalid YAML", async () => {
    const { loadYamlRegistry } = await import("../../src/lib/sources/catalog.js");
    const tempDir = mkdtempSync(join(tmpdir(), "yaml-bad-"));
    const path = join(tempDir, "sources.yaml");
    writeFileSync(path, "{{{{invalid yaml}}}}");

    const result = loadYamlRegistry(path);
    expect(result).toEqual([]);
  });

  it("filters out records missing name or url", async () => {
    const { loadYamlRegistry } = await import("../../src/lib/sources/catalog.js");
    const tempDir = mkdtempSync(join(tmpdir(), "yaml-partial-"));
    const path = join(tempDir, "sources.yaml");
    writeFileSync(path, `
sources:
  - name: Good Source
    url: https://example.com
  - name: Missing URL
  - url: https://missing-name.com
`);

    const sources = loadYamlRegistry(path);
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe("Good Source");
  });
});

describe("catalog — loadCatalog with rating/health data", () => {
  it("preserves all rating fields through load", async () => {
    const { loadCatalog } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource({
      rating: {
        overall: 92,
        uptime: 99,
        relevance: 85,
        freshness: 80,
        sizeStability: 90,
        engagement: 75,
        trust: 95,
        lastTestedAt: "2025-06-01T12:00:00Z",
        testCount: 100,
        successCount: 98,
        consecutiveFailures: 0,
      },
    });
    const path = writeTempCatalog([source]);

    const catalog = loadCatalog(path);
    expect(catalog).not.toBeNull();
    const loaded = catalog!.sources[0];
    expect(loaded.rating.overall).toBe(92);
    expect(loaded.rating.uptime).toBe(99);
    expect(loaded.rating.testCount).toBe(100);
    expect(loaded.rating.successCount).toBe(98);
    expect(loaded.rating.consecutiveFailures).toBe(0);
    expect(loaded.rating.lastTestedAt).toBe("2025-06-01T12:00:00Z");
  });

  it("preserves lifecycle data through load", async () => {
    const { loadCatalog } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource({
      status: "degraded",
      lifecycle: {
        discoveredAt: "2024-01-01T00:00:00Z",
        discoveredBy: "auto-discovery",
        promotedAt: "2024-02-01T00:00:00Z",
        statusChangedAt: "2025-05-01T00:00:00Z",
        lastUsedAt: "2025-06-01T00:00:00Z",
        lastFailedAt: "2025-05-30T00:00:00Z",
        failureReason: "timeout",
      },
    });
    const path = writeTempCatalog([source]);

    const catalog = loadCatalog(path);
    expect(catalog).not.toBeNull();
    const loaded = catalog!.sources[0];
    expect(loaded.status).toBe("degraded");
    expect(loaded.lifecycle.discoveredBy).toBe("auto-discovery");
    expect(loaded.lifecycle.promotedAt).toBe("2024-02-01T00:00:00Z");
    expect(loaded.lifecycle.failureReason).toBe("timeout");
  });
});

describe("catalog — source filtering by domain", () => {
  it("filters sources by domain tag using index", async () => {
    const { buildSourceIndex } = await import("../../src/lib/sources/catalog.js");
    const defi = makeSource({ id: "defi-1", domainTags: ["defi", "crypto"] });
    const ai = makeSource({ id: "ai-1", domainTags: ["ai", "research"] });
    const both = makeSource({ id: "both-1", domainTags: ["defi", "ai"] });

    const index = buildSourceIndex([defi, ai, both]);

    const defiSources = index.byDomainTag.get("defi");
    expect(defiSources?.size).toBe(2);
    expect(defiSources?.has("defi-1")).toBe(true);
    expect(defiSources?.has("both-1")).toBe(true);

    const aiSources = index.byDomainTag.get("ai");
    expect(aiSources?.size).toBe(2);
    expect(aiSources?.has("ai-1")).toBe(true);
    expect(aiSources?.has("both-1")).toBe(true);
  });

  it("domain tag lookup is case-insensitive", async () => {
    const { buildSourceIndex } = await import("../../src/lib/sources/catalog.js");
    const source = makeSource({ id: "s1", domainTags: ["DeFi"] });

    const index = buildSourceIndex([source]);
    // Tags are lowercased in the index
    expect(index.byDomainTag.get("defi")?.has("s1")).toBe(true);
  });
});
