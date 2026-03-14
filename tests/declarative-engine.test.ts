import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { SourceRecordV2 } from "../tools/lib/sources/catalog.js";

import {
  _extractItems,
  _jsonPathGet,
  _mapItemToEntry,
  _resolveVariable,
  loadDeclarativeProviderAdaptersSync,
} from "../tools/lib/sources/providers/declarative-engine.js";

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "source-1",
    name: "GitHub Search",
    provider: "github",
    url: "https://api.github.com/search/repositories",
    urlPattern: "api.github.com/search/repositories",
    topics: ["github", "code"],
    tlsn_safe: true,
    dahr_safe: true,
    max_response_kb: 8,
    topicAliases: ["oss"],
    domainTags: ["tech"],
    responseFormat: "json",
    scope: { visibility: "global", importedFrom: ["sentinel"] },
    runtime: {
      timeoutMs: 5000,
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
    adapter: { operation: "search-repos" },
    ...overrides,
  };
}

describe("jsonPathGet", () => {
  it("supports field, nested, wildcard, index, and nested array access", () => {
    const input = {
      field: "value",
      a: { b: 3 },
      arr: [{ name: "btc" }, { name: "eth" }],
      nested: [[0], ["deep"]],
    };

    expect(_jsonPathGet(input, "$.field")).toBe("value");
    expect(_jsonPathGet(input, "$.a.b")).toBe(3);
    expect(_jsonPathGet(input, "$.arr[*].name")).toEqual(["btc", "eth"]);
    expect(_jsonPathGet(["zero", "one", "two"], "$[1]")).toBe("one");
    expect(_jsonPathGet(input, "$.nested[1][0]")).toBe("deep");
  });
});

describe("template and nested field resolution", () => {
  it("resolves dotted paths, bracket notation, key fallback chains, variables, and literal fallbacks", () => {
    const entry = _mapItemToEntry(
      {
        meta: { title: "Deep Dive" },
        content: [{ text: "Body copy" }],
      },
      "row-1",
      {
        id: { template: "{missing|key|(fallback-id)}", required: true },
        title: { template: "{headline|meta.title|query|(untitled)}" },
        summary: { template: "{missing|(fallback summary)}" },
        bodyText: { template: "{content[0].text|(no body)}" },
        raw: { mode: "item" } as any,
      },
      { query: "Bitcoin ETF" },
      undefined,
      null
    );

    expect(entry).toMatchObject({
      id: "row-1",
      title: "Deep Dive",
      summary: "fallback summary",
      bodyText: "Body copy",
    });
  });

  it("returns null when required id resolution fails", () => {
    const entry = _mapItemToEntry(
      { meta: {} },
      undefined,
      {
        id: { template: "{missing}", required: true },
        bodyText: { template: "{meta.text|(none)}" },
      },
      {},
      undefined,
      null
    );

    expect(entry).toBeNull();
  });
});

describe("variable resolution", () => {
  it("uses source chains and string transforms", () => {
    const ctx = {
      source: makeSource(),
      topic: "Bitcoin ETF",
      tokens: ["bitcoin", "ETF"],
      vars: {
        tone: "Bullish",
      },
      attestation: "TLSN" as const,
      maxCandidates: 1,
    };

    expect(
      _resolveVariable(
        { sources: ["vars.missing", "tokens[1]", "topic"], transforms: ["uppercase"] },
        ctx
      )
    ).toBe("ETF");
    expect(
      _resolveVariable(
        { sources: ["vars.tone"], transforms: ["lowercase", { map: { bullish: "up" } }] },
        ctx
      )
    ).toBe("up");
    expect(
      _resolveVariable(
        { sources: ["topic"], transforms: ["slug"] },
        ctx
      )
    ).toBe("bitcoin-etf");
  });
});

describe("parse modes", () => {
  it("extracts json-path items from an envelope", () => {
    const items = _extractItems(
      { data: { items: [{ id: 1 }, { id: 2 }] } },
      {
        format: "json",
        envelope: { jsonPath: "$.data" },
        items: { mode: "json-path", jsonPath: "$.items[*]" },
        fields: {},
      },
      ""
    );

    expect(items).toEqual([{ item: { id: 1 } }, { item: { id: 2 } }]);
  });

  it("extracts a single object", () => {
    const items = _extractItems(
      { id: 7, name: "only" },
      {
        format: "json",
        items: { mode: "single-object" },
        fields: {},
      },
      ""
    );

    expect(items).toEqual([{ item: { id: 7, name: "only" } }]);
  });

  it("maps array tuples into objects", () => {
    const items = _extractItems(
      [
        [1, "btc"],
        [2, "eth"],
      ],
      {
        format: "json",
        items: { mode: "array-tuples", tupleFields: ["rank", "asset"] },
        fields: {},
      },
      ""
    );

    expect(items).toEqual([
      { item: { rank: 1, asset: "btc" } },
      { item: { rank: 2, asset: "eth" } },
    ]);
  });
});

describe("loadDeclarativeProviderAdaptersSync", () => {
  it("loads adapters from the specs directory and builds candidates", () => {
    const specDir = resolve(process.cwd(), "tools/lib/sources/providers/specs");
    const adapters = loadDeclarativeProviderAdaptersSync({ specDir, strictValidation: false });

    expect(adapters.size).toBeGreaterThan(5);
    expect(adapters.has("github")).toBe(true);
    expect(adapters.has("wikipedia")).toBe(true);

    const github = adapters.get("github");
    expect(github).toBeTruthy();
    expect(github?.supports(makeSource())).toBe(true);

    const candidates = github?.buildCandidates({
      source: makeSource(),
      topic: "OpenAI Codex",
      tokens: ["openai", "codex"],
      vars: { query: "openai codex" },
      attestation: "TLSN",
      maxCandidates: 1,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates?.[0].url).toContain("q=openai+codex");
  });
});
