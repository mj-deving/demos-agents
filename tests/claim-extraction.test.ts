import { describe, expect, it, vi } from "vitest";
import {
  extractStructuredClaims,
  extractStructuredClaimsWithLLM,
  extractStructuredClaimsAuto,
  type ExtractedClaim,
} from "../src/lib/claim-extraction.js";
import type { LLMProvider } from "../src/lib/llm-provider.js";

// ── Helpers ──────────────────────────────────────────

function makeLLM(response: string): LLMProvider {
  return {
    name: "test-provider",
    complete: vi.fn().mockResolvedValue(response),
  };
}

function findClaim(claims: ExtractedClaim[], type: string, valueFn?: (v: number) => boolean): ExtractedClaim | undefined {
  return claims.find((c) => c.type === type && (valueFn ? c.value !== undefined && valueFn(c.value) : true));
}

// ── Rule-Based Extraction ────────────────────────────

describe("extractStructuredClaims", () => {
  describe("price patterns", () => {
    it("extracts $X,XXX dollar amounts", () => {
      const claims = extractStructuredClaims("Bitcoin is trading at $64,231 today.");
      const price = findClaim(claims, "price");
      expect(price).toBeDefined();
      expect(price!.value).toBe(64231);
      expect(price!.unit).toBe("USD");
    });

    it("extracts $X.XX decimal dollar amounts", () => {
      const claims = extractStructuredClaims("Token price dropped to $0.50 per unit.");
      const price = findClaim(claims, "price");
      expect(price).toBeDefined();
      expect(price!.value).toBe(0.5);
      expect(price!.unit).toBe("USD");
    });

    it("extracts $X,XXX,XXX large amounts", () => {
      const claims = extractStructuredClaims("Market cap reached $1,234,567 this quarter.");
      const price = findClaim(claims, "price");
      expect(price).toBeDefined();
      expect(price!.value).toBe(1234567);
    });

    it("extracts $X.XB shorthand billions without double-extracting as plain USD", () => {
      const claims = extractStructuredClaims("Protocol TVL is $2.3B across all chains.");
      const metric = findClaim(claims, "metric");
      expect(metric).toBeDefined();
      expect(metric!.value).toBe(2_300_000_000);
      expect(metric!.unit).toBe("USD");
      // Must NOT also extract $2.3 as a plain price
      const bogusPrice = findClaim(claims, "price", (v) => v === 2.3);
      expect(bogusPrice).toBeUndefined();
    });

    it("extracts $X.XM shorthand millions without double-extracting", () => {
      const claims = extractStructuredClaims("Daily volume hit $500M on the exchange.");
      const metric = findClaim(claims, "metric");
      expect(metric).toBeDefined();
      expect(metric!.value).toBe(500_000_000);
      // Must NOT also extract $500 as a plain price
      const bogusPrice = findClaim(claims, "price", (v) => v === 500);
      expect(bogusPrice).toBeUndefined();
    });

    it("extracts $XK shorthand thousands without double-extracting", () => {
      const claims = extractStructuredClaims("Average transaction size is $10K.");
      const metric = findClaim(claims, "metric");
      expect(metric).toBeDefined();
      expect(metric!.value).toBe(10_000);
      // Must NOT also extract $10 as a plain price
      const bogusPrice = findClaim(claims, "price", (v) => v === 10);
      expect(bogusPrice).toBeUndefined();
    });
  });

  describe("percentage patterns", () => {
    it("extracts integer percentages", () => {
      const claims = extractStructuredClaims("Bitcoin rose 12% this week.");
      const metric = findClaim(claims, "metric", (v) => v === 12);
      expect(metric).toBeDefined();
      expect(metric!.unit).toBe("%");
    });

    it("extracts decimal percentages", () => {
      const claims = extractStructuredClaims("Inflation is at 3.5% annually.");
      const metric = findClaim(claims, "metric", (v) => v === 3.5);
      expect(metric).toBeDefined();
      expect(metric!.unit).toBe("%");
    });
  });

  describe("domain unit patterns", () => {
    it("extracts gwei amounts", () => {
      const claims = extractStructuredClaims("Ethereum gas fees dropped to 3 gwei.");
      const price = findClaim(claims, "price", (v) => v === 3);
      expect(price).toBeDefined();
      expect(price!.unit).toBe("gwei");
    });

    it("extracts sats amounts", () => {
      const claims = extractStructuredClaims("Lightning fee is 100 sats per hop.");
      const price = findClaim(claims, "price", (v) => v === 100);
      expect(price).toBeDefined();
      expect(price!.unit).toBe("sats");
    });

    it("extracts DEM amounts", () => {
      const claims = extractStructuredClaims("Attestation costs about 12 DEM on testnet.");
      const price = findClaim(claims, "price", (v) => v === 12);
      expect(price).toBeDefined();
      expect(price!.unit).toBe("dem");
    });

    it("extracts TVL amounts", () => {
      const claims = extractStructuredClaims("Uniswap has 4500 TVL locked in the pool.");
      const price = findClaim(claims, "price", (v) => v === 4500);
      expect(price).toBeDefined();
      expect(price!.unit).toBe("tvl");
    });
  });

  describe("entity extraction", () => {
    it("associates Bitcoin entity with nearby price", () => {
      const claims = extractStructuredClaims("Bitcoin is trading at $64,231 today.");
      const price = findClaim(claims, "price");
      expect(price).toBeDefined();
      expect(price!.entities).toContain("bitcoin");
      expect(price!.entities).toContain("BTC");
    });

    it("associates Ethereum entity with nearby metric", () => {
      const claims = extractStructuredClaims("Ethereum gas fees have dropped to 3 gwei this week.");
      const price = findClaim(claims, "price", (v) => v === 3);
      expect(price).toBeDefined();
      expect(price!.entities).toContain("ethereum");
      expect(price!.entities).toContain("ETH");
    });

    it("extracts entity-only claims when no numeric data", () => {
      const claims = extractStructuredClaims("Bitcoin and Ethereum are showing strong momentum this quarter.");
      expect(claims.length).toBeGreaterThan(0);
      const entityClaim = claims.find((c) => c.type === "event");
      expect(entityClaim).toBeDefined();
      expect(entityClaim!.entities.length).toBeGreaterThan(0);
    });

    it("does not false-positive on English words that collide with tickers", () => {
      // "link", "near", "op", "dot", "uni" are English words — should NOT match as crypto entities
      const claims = extractStructuredClaims("Please open the link near the dot point. The uni op team handled it.");
      // No known crypto entities, no numbers → should return empty
      expect(claims).toEqual([]);
    });

    it("matches full asset names case-insensitively", () => {
      const claims = extractStructuredClaims("Polkadot and Chainlink are gaining momentum in DeFi.");
      expect(claims.length).toBeGreaterThan(0);
      const entities = claims.flatMap((c) => c.entities);
      expect(entities).toContain("polkadot");
      expect(entities).toContain("chainlink");
    });
  });

  describe("real post examples", () => {
    it("extracts multiple claims from a crypto analysis post", () => {
      const post = "Bitcoin futures are trading at $64,231 with open interest up 12% this week. Ethereum gas fees have dropped to 3 gwei, the lowest since January.";
      const claims = extractStructuredClaims(post);

      // Should find: $64,231 price, 12% metric, 3 gwei price
      expect(claims.length).toBeGreaterThanOrEqual(3);

      const btcPrice = findClaim(claims, "price", (v) => v === 64231);
      expect(btcPrice).toBeDefined();
      expect(btcPrice!.unit).toBe("USD");

      const percentage = findClaim(claims, "metric", (v) => v === 12);
      expect(percentage).toBeDefined();
      expect(percentage!.unit).toBe("%");

      const gasFee = findClaim(claims, "price", (v) => v === 3);
      expect(gasFee).toBeDefined();
      expect(gasFee!.unit).toBe("gwei");
    });

    it("extracts claims from a DeFi TVL post", () => {
      const post = "Total DeFi TVL has rebounded to $2.3B, driven by Ethereum staking yields at 4.5%.";
      const claims = extractStructuredClaims(post);

      const tvl = findClaim(claims, "metric", (v) => v === 2_300_000_000);
      expect(tvl).toBeDefined();

      const yield_ = findClaim(claims, "metric", (v) => v === 4.5);
      expect(yield_).toBeDefined();
      expect(yield_!.unit).toBe("%");
    });

    it("extracts claims from a multi-asset post", () => {
      const post = "SOL surged 8% to $145 while BTC consolidated near $63,500. ETH gas at 5 gwei.";
      const claims = extractStructuredClaims(post);

      expect(claims.length).toBeGreaterThanOrEqual(3);

      // Should have both price points
      const sol = findClaim(claims, "price", (v) => v === 145);
      expect(sol).toBeDefined();

      const btc = findClaim(claims, "price", (v) => v === 63500);
      expect(btc).toBeDefined();
    });
  });

  describe("deduplication", () => {
    it("does not duplicate same value+unit", () => {
      const claims = extractStructuredClaims("BTC at $64,231. Bitcoin trading at $64,231.");
      const prices = claims.filter((c) => c.type === "price" && c.value === 64231);
      expect(prices.length).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty string", () => {
      expect(extractStructuredClaims("")).toEqual([]);
    });

    it("returns empty array for whitespace", () => {
      expect(extractStructuredClaims("   \n\t  ")).toEqual([]);
    });

    it("returns empty array for text with no extractable claims", () => {
      const claims = extractStructuredClaims("The market looks interesting today.");
      // No known entities, no numbers — should return empty
      expect(claims).toEqual([]);
    });
  });
});

// ── LLM Extraction ───────────────────────────────────

describe("extractStructuredClaimsWithLLM", () => {
  it("parses structured LLM response", async () => {
    const llm = makeLLM(JSON.stringify([
      { text: "BTC at $64,231", type: "price", entities: ["bitcoin", "BTC"], value: 64231, unit: "USD" },
      { text: "gas at 3 gwei", type: "price", entities: ["ethereum"], value: 3, unit: "gwei" },
    ]));

    const claims = await extractStructuredClaimsWithLLM("test post", llm);

    expect(claims.length).toBe(2);
    expect(claims[0].type).toBe("price");
    expect(claims[0].value).toBe(64231);
    expect(claims[0].entities).toContain("bitcoin");
    expect(claims[1].unit).toBe("gwei");
  });

  it("handles markdown code fences in LLM response", async () => {
    const llm = makeLLM('```json\n[{"text":"test","type":"event","entities":["bitcoin"]}]\n```');

    const claims = await extractStructuredClaimsWithLLM("test post", llm);
    expect(claims.length).toBe(1);
    expect(claims[0].type).toBe("event");
  });

  it("returns empty array on invalid JSON", async () => {
    const llm = makeLLM("not json at all");
    const claims = await extractStructuredClaimsWithLLM("test", llm);
    expect(claims).toEqual([]);
  });

  it("returns empty array on LLM error", async () => {
    const llm: LLMProvider = {
      name: "failing-provider",
      complete: vi.fn().mockRejectedValue(new Error("API error")),
    };
    const claims = await extractStructuredClaimsWithLLM("test", llm);
    expect(claims).toEqual([]);
  });

  it("returns empty array on timeout", async () => {
    const llm: LLMProvider = {
      name: "slow-provider",
      complete: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 15_000))),
    };
    const claims = await extractStructuredClaimsWithLLM("test", llm);
    expect(claims).toEqual([]);
  }, 12_000);

  it("validates claim types and defaults unknown to event", async () => {
    const llm = makeLLM(JSON.stringify([
      { text: "test", type: "unknown_type", entities: [] },
    ]));
    const claims = await extractStructuredClaimsWithLLM("test", llm);
    expect(claims[0].type).toBe("event");
  });

  it("filters out non-object array elements", async () => {
    const llm = makeLLM(JSON.stringify([
      "just a string",
      { text: "valid", type: "price", entities: ["btc"], value: 100 },
      42,
    ]));
    const claims = await extractStructuredClaimsWithLLM("test", llm);
    expect(claims.length).toBe(1);
    expect(claims[0].text).toBe("valid");
  });
});

// ── Auto Extraction ──────────────────────────────────

describe("extractStructuredClaimsAuto", () => {
  it("uses rules when they produce claims", async () => {
    const llm = makeLLM("[]");
    const claims = await extractStructuredClaimsAuto("BTC at $64,231 with 12% gain.", llm);

    // Rules should find $64,231 and 12% — LLM should NOT be called
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect((llm.complete as any)).not.toHaveBeenCalled();
  });

  it("falls back to LLM when rules produce 0 claims", async () => {
    const llm = makeLLM(JSON.stringify([
      { text: "market momentum", type: "trend", entities: ["crypto"] },
    ]));
    // Text with no numbers or known entities
    const claims = await extractStructuredClaimsAuto("The market shows interesting momentum.", llm);

    expect(claims.length).toBe(1);
    expect(claims[0].type).toBe("trend");
    expect((llm.complete as any)).toHaveBeenCalledOnce();
  });

  it("returns empty when rules fail and no LLM", async () => {
    const claims = await extractStructuredClaimsAuto("The market looks quiet.", null);
    expect(claims).toEqual([]);
  });

  it("returns empty when rules fail and LLM is undefined", async () => {
    const claims = await extractStructuredClaimsAuto("Nothing extractable here.");
    expect(claims).toEqual([]);
  });
});
