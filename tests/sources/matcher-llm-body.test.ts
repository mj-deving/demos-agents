import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../../src/lib/llm/llm-provider.js";
import { scoreBodyMatchLLM, scoreEvidence } from "../../src/lib/sources/matcher.js";
import type { SourceRecordV2 } from "../../src/lib/sources/catalog.js";
import type { EvidenceEntry } from "../../src/lib/sources/providers/types.js";

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "src-llm-body",
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

function makeEntries(): EvidenceEntry[] {
  return [
    {
      id: "entry-1",
      title: "Bitcoin price snapshot",
      bodyText: "{\"asset\":\"BTC\",\"price_usd\":64000,\"window\":\"24h\"}",
      topics: ["crypto"],
      raw: {},
    },
  ];
}

function makeLLM(response: string | Promise<string>): LLMProvider {
  return {
    name: "mock-llm",
    complete: typeof response === "string"
      ? vi.fn().mockResolvedValue(response)
      : vi.fn().mockImplementation(() => response),
  };
}

describe("scoreBodyMatchLLM", () => {
  it("returns parsed score and matched claims from a valid LLM response", async () => {
    const llm = makeLLM('{"score":18,"matched_claims":["bitcoin","$64000"]}');

    const result = await scoreBodyMatchLLM(
      ["bitcoin", "$64000", "market cap"],
      makeEntries(),
      llm,
    );

    expect(result).toEqual({
      bodyScore: 18,
      bodyMatches: 2,
      matchedClaims: ["bitcoin", "$64000"],
    });
  });

  it("returns zeros when the LLM call times out", async () => {
    vi.useFakeTimers();
    const llm = makeLLM(new Promise<string>(() => {}));

    const pending = scoreBodyMatchLLM(["bitcoin"], makeEntries(), llm);
    await vi.advanceTimersByTimeAsync(10_001);

    await expect(pending).resolves.toEqual({
      bodyScore: 0,
      bodyMatches: 0,
      matchedClaims: [],
    });
    vi.useRealTimers();
  });

  it("returns zeros when the LLM response is invalid JSON", async () => {
    const llm = makeLLM("not json");

    const result = await scoreBodyMatchLLM(["bitcoin"], makeEntries(), llm);

    expect(result).toEqual({
      bodyScore: 0,
      bodyMatches: 0,
      matchedClaims: [],
    });
  });

  it("clamps body scores to the 0-25 range", async () => {
    const llm = makeLLM('{"score":50,"matched_claims":["bitcoin"]}');

    const result = await scoreBodyMatchLLM(["bitcoin"], makeEntries(), llm);

    expect(result).toEqual({
      bodyScore: 25,
      bodyMatches: 1,
      matchedClaims: ["bitcoin"],
    });
  });
});

describe("scoreEvidence with LLM body scoring", () => {
  it("sets body_match to 0 when llm is null", async () => {
    const result = await scoreEvidence(
      ["bitcoin", "$64000"],
      makeEntries(),
      makeSource(),
      ["crypto"],
      null,
    );

    expect(result.axes.body_match).toBe(0);
  });

  it("uses the LLM body score when llm is provided", async () => {
    const llm = makeLLM('{"score":18,"matched_claims":["bitcoin","$64000"]}');

    const result = await scoreEvidence(
      ["bitcoin", "$64000"],
      makeEntries(),
      makeSource(),
      ["crypto"],
      llm,
    );

    expect(result.axes.body_match).toBe(18);
    expect(result.matchedClaims).toEqual(expect.arrayContaining(["bitcoin", "$64000"]));
    expect(result.evidence).toEqual(expect.arrayContaining([expect.stringContaining("body match")]));
  });
});
