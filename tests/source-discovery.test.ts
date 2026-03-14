import { describe, expect, it, vi } from "vitest";
import type { SourceRecordV2 } from "../tools/lib/sources/catalog.js";

vi.mock("../tools/lib/sdk.js", () => ({
  apiCall: vi.fn(),
  info: vi.fn(),
}));

// Mock catalog loading for persistSourceToCatalog
const loadCatalogMock = vi.hoisted(() => vi.fn());
vi.mock("../tools/lib/sources/catalog.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    loadCatalog: loadCatalogMock,
  };
});

import { analyzeCoverage, persistSourceToCatalog, type DiscoveredSource, type CoverageGap } from "../tools/lib/source-discovery.js";

// ── Fixtures ─────────────────────────────────────────

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: `src-${Math.random().toString(36).slice(2, 8)}`,
    name: "Test Source",
    provider: "coingecko",
    url: "https://api.example.com/test",
    urlPattern: "api.example.com/test",
    topics: ["test"],
    tlsn_safe: true,
    dahr_safe: true,
    max_response_kb: 8,
    topicAliases: [],
    domainTags: ["test"],
    responseFormat: "json",
    scope: { visibility: "global", importedFrom: ["sentinel"] },
    runtime: {
      timeoutMs: 5000,
      retry: { maxAttempts: 2, backoffMs: 500, retryOn: ["timeout"] },
    },
    trustTier: "official",
    status: "active",
    rating: {
      overall: 90, uptime: 90, relevance: 90, freshness: 90,
      sizeStability: 90, engagement: 90, trust: 90,
      testCount: 10, successCount: 10, consecutiveFailures: 0,
    },
    lifecycle: {
      discoveredAt: "2026-01-01T00:00:00.000Z",
      discoveredBy: "manual",
    },
    ...overrides,
  };
}

// ── analyzeCoverage ──────────────────────────────────

describe("analyzeCoverage", () => {
  it("returns gaps for topics with 0 active sources", () => {
    const sources = [
      makeSource({ topics: ["crypto"], status: "active" }),
    ];

    const gaps = analyzeCoverage(sources, ["crypto", "quantum"]);

    const quantumGap = gaps.find((g) => g.topic === "quantum");
    expect(quantumGap).toBeDefined();
    expect(quantumGap!.activeSourceCount).toBe(0);
  });

  it("returns gaps for topics with 1 active source (below threshold of 2)", () => {
    const sources = [
      makeSource({ topics: ["crypto"], status: "active" }),
    ];

    const gaps = analyzeCoverage(sources, ["crypto"]);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].activeSourceCount).toBe(1);
  });

  it("returns no gaps for topics with 2+ active sources", () => {
    const sources = [
      makeSource({ topics: ["crypto"], status: "active" }),
      makeSource({ topics: ["crypto"], status: "active" }),
    ];

    const gaps = analyzeCoverage(sources, ["crypto"]);

    expect(gaps).toHaveLength(0);
  });

  it("ignores quarantined sources in active coverage count", () => {
    const sources = [
      makeSource({ topics: ["crypto"], status: "active" }),
      makeSource({ topics: ["crypto"], status: "quarantined" }),
    ];

    const gaps = analyzeCoverage(sources, ["crypto"]);

    // Only 1 active source, quarantined doesn't count
    expect(gaps).toHaveLength(1);
    expect(gaps[0].activeSourceCount).toBe(1);
    expect(gaps[0].totalSourceCount).toBe(2);
  });

  it("ignores deprecated sources in coverage count", () => {
    const sources = [
      makeSource({ topics: ["tech"], status: "deprecated" }),
    ];

    const gaps = analyzeCoverage(sources, ["tech"]);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].activeSourceCount).toBe(0);
  });

  it("sorts gaps by coverage (least covered first)", () => {
    const sources = [
      makeSource({ topics: ["crypto"], status: "active" }),
      // "quantum" has 0 sources, "crypto" has 1
    ];

    const gaps = analyzeCoverage(sources, ["crypto", "quantum"]);

    expect(gaps[0].topic).toBe("quantum"); // 0 sources
    expect(gaps[1].topic).toBe("crypto");  // 1 source
  });
});

// ── persistSourceToCatalog ───────────────────────────

describe("persistSourceToCatalog", () => {
  const discovered: DiscoveredSource = {
    source: {
      name: "hn-quantum-computing",
      url: "https://hn.algolia.com/api/v1/search?query=quantum+computing&tags=story&hitsPerPage=2",
      topics: ["quantum", "computing"],
      tlsn_safe: true,
      dahr_safe: true,
      max_response_kb: 4,
      note: "Auto-discovered. Provider: hn-algolia. Relevance: 72/100.",
    },
    url: "https://hn.algolia.com/api/v1/search?query=quantum+computing&tags=story&hitsPerPage=2",
    relevanceScore: 72,
    reason: "3/4 terms matched, 2 entries",
  };

  it("returns null when catalog not found", () => {
    loadCatalogMock.mockReturnValue(null);

    const result = persistSourceToCatalog("/fake/path", discovered);

    expect(result).toBeNull();
  });

  it("creates valid SourceRecordV2 with quarantined status", () => {
    // Write a real temp catalog file for this test
    const { writeFileSync, unlinkSync, existsSync: fsExists } = require("node:fs");
    const tmpCatalog = "/tmp/test-discovery-catalog.json";
    writeFileSync(tmpCatalog, JSON.stringify({
      version: 2,
      generatedAt: "2026-01-01T00:00:00.000Z",
      sources: [],
    }, null, 2));

    // Use the real loadCatalog for this test
    loadCatalogMock.mockImplementation(() => {
      const raw = require("node:fs").readFileSync(tmpCatalog, "utf-8");
      return JSON.parse(raw);
    });

    const result = persistSourceToCatalog(tmpCatalog, discovered);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("quarantined");
    expect(result!.lifecycle.discoveredBy).toBe("auto-discovery");
    expect(result!.trustTier).toBe("experimental");
    expect(result!.provider).toBe("hn-algolia");

    // Cleanup
    if (fsExists(tmpCatalog)) unlinkSync(tmpCatalog);
  });

  it("returns null for duplicate name", () => {
    loadCatalogMock.mockReturnValue({
      version: 2,
      generatedAt: "2026-01-01T00:00:00.000Z",
      sources: [
        makeSource({ name: "hn-quantum-computing" }),
      ],
    });

    const result = persistSourceToCatalog("/tmp/test-catalog.json", discovered);

    expect(result).toBeNull();
  });
});
