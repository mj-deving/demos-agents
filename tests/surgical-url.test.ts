/**
 * Tests for surgical URL construction from claims (Phase 2).
 *
 * Verifies that buildSurgicalUrl on declarative adapters correctly:
 * - Matches claim types to operations with claimTypes
 * - Resolves variables from claim entities
 * - Interpolates extractionPath with resolved variables
 * - Carries provider + rateLimitBucket metadata
 * - Returns null for unsupported claims
 */

import { describe, it, expect, beforeAll } from "vitest";
import { loadDeclarativeProviderAdaptersSync } from "../src/lib/sources/providers/declarative-engine.js";
import type { ProviderAdapter, SurgicalCandidate } from "../src/lib/sources/providers/types.js";
import type { ExtractedClaim } from "../src/lib/claim-extraction.js";
import type { SourceRecordV2 } from "../src/lib/sources/catalog.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = resolve(__dirname, "../src/lib/sources/providers/specs");

// ── Test Helpers ────────────────────────────────────

function makeClaim(overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return {
    text: "BTC at $64,231",
    type: "price",
    entities: ["bitcoin", "BTC"],
    value: 64231,
    unit: "USD",
    ...overrides,
  };
}

function makeSource(provider: string, operation: string): SourceRecordV2 {
  return {
    id: `test-${provider}-${operation}`,
    name: `Test ${provider}`,
    url: `https://api.${provider}.com/test`,
    provider,
    adapter: { operation },
    topics: ["crypto"],
    status: "active" as any,
    responseFormat: "json",
    attestation: { tlsn: true, dahr: true },
  } as any;
}

// ── Tests ───────────────────────────────────────────

describe("Surgical URL construction", () => {
  let adapters: Map<string, ProviderAdapter>;

  beforeAll(() => {
    adapters = loadDeclarativeProviderAdaptersSync({ specDir: SPEC_DIR });
  });

  describe("Binance ticker-price", () => {
    it("returns SurgicalCandidate for BTC price claim", () => {
      const adapter = adapters.get("binance");
      expect(adapter).toBeDefined();
      expect(adapter!.buildSurgicalUrl).toBeDefined();

      const claim = makeClaim({ entities: ["bitcoin", "BTC"] });
      const source = makeSource("binance", "ticker-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.url).toContain("BTCUSDT");
      expect(result!.extractionPath).toBe("$.price");
      expect(result!.method).toBe("GET");
      expect(result!.provider).toBe("binance");
    });

    it("returns SurgicalCandidate for ETH price claim", () => {
      const adapter = adapters.get("binance");
      const claim = makeClaim({ entities: ["ethereum", "ETH"] });
      const source = makeSource("binance", "ticker-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.url).toContain("ETHUSDT");
    });

    it("carries rateLimitBucket from spec", () => {
      const adapter = adapters.get("binance");
      const claim = makeClaim();
      const source = makeSource("binance", "ticker-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.rateLimitBucket).toBe("binance");
    });
  });

  describe("CoinGecko simple-price", () => {
    it("returns SurgicalCandidate for BTC with correct extractionPath", () => {
      const adapter = adapters.get("coingecko");
      expect(adapter).toBeDefined();

      const claim = makeClaim({ entities: ["bitcoin", "BTC"] });
      const source = makeSource("coingecko", "simple-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.url).toContain("ids=bitcoin");
      expect(result!.extractionPath).toBe("$.bitcoin.usd");
      expect(result!.provider).toBe("coingecko");
    });

    it("returns SurgicalCandidate for ETH with correct templated extractionPath", () => {
      const adapter = adapters.get("coingecko");
      const claim = makeClaim({ entities: ["ethereum", "ETH"] });
      const source = makeSource("coingecko", "simple-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.extractionPath).toBe("$.ethereum.usd");
      expect(result!.url).toContain("ids=ethereum");
    });

    it("canonicalizes ticker symbol to full name for CoinGecko", () => {
      const adapter = adapters.get("coingecko");
      // Pass "BTC" only (ticker) — should resolve to canonical "bitcoin" for CoinGecko
      const claim = makeClaim({ entities: ["BTC"] });
      const source = makeSource("coingecko", "simple-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      // inferAssetAlias("BTC") → { asset: "bitcoin", symbol: "BTC" }
      expect(result!.url).toContain("ids=bitcoin");
      expect(result!.extractionPath).toBe("$.bitcoin.usd");
    });

    it("carries rateLimitBucket from spec", () => {
      const adapter = adapters.get("coingecko");
      const claim = makeClaim();
      const source = makeSource("coingecko", "simple-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.rateLimitBucket).toBe("coingecko");
    });
  });

  describe("Etherscan gas-oracle", () => {
    it("returns SurgicalCandidate for gas price claim", () => {
      const adapter = adapters.get("etherscan");
      expect(adapter).toBeDefined();

      const claim = makeClaim({ entities: ["ethereum", "ETH"], text: "gas at 15 gwei" });
      const source = makeSource("etherscan", "gas-oracle");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.url).toContain("gasoracle");
      expect(result!.extractionPath).toBe("$.result.ProposeGasPrice");
    });
  });

  describe("Null cases", () => {
    it("returns null for trend claim type", () => {
      const adapter = adapters.get("binance");
      const claim = makeClaim({ type: "trend" });
      const source = makeSource("binance", "ticker-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).toBeNull();
    });

    it("returns null for quote claim type", () => {
      const adapter = adapters.get("coingecko");
      const claim = makeClaim({ type: "quote" });
      const source = makeSource("coingecko", "simple-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).toBeNull();
    });

    it("returns null for event claim type when no event claimTypes defined", () => {
      const adapter = adapters.get("binance");
      const claim = makeClaim({ type: "event" });
      const source = makeSource("binance", "ticker-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).toBeNull();
    });
  });

  describe("CryptoCompare price", () => {
    it("returns SurgicalCandidate for BTC price claim", () => {
      const adapter = adapters.get("cryptocompare");
      expect(adapter).toBeDefined();
      expect(adapter!.buildSurgicalUrl).toBeDefined();

      const claim = makeClaim({ entities: ["bitcoin", "BTC"] });
      const source = makeSource("cryptocompare", "price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.url).toContain("fsym=BTC");
      expect(result!.extractionPath).toBe("$.USD");
      expect(result!.provider).toBe("cryptocompare");
    });

    it("returns null for metric claim type", () => {
      const adapter = adapters.get("cryptocompare");
      const claim = makeClaim({ type: "metric" });
      const source = makeSource("cryptocompare", "price");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).toBeNull();
    });
  });

  describe("Mempool fees", () => {
    it("returns SurgicalCandidate for metric claim", () => {
      const adapter = adapters.get("mempool");
      expect(adapter).toBeDefined();
      expect(adapter!.buildSurgicalUrl).toBeDefined();

      const claim = makeClaim({ type: "metric", entities: ["bitcoin", "BTC"], text: "fees at 14 sat/vB", value: 14, unit: "sat/vB" });
      const source = makeSource("mempool", "fees");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.url).toContain("fees/recommended");
      expect(result!.extractionPath).toBe("$.fastestFee");
      expect(result!.provider).toBe("mempool");
    });

    it("returns null for price claim type", () => {
      const adapter = adapters.get("mempool");
      const claim = makeClaim({ type: "price" });
      const source = makeSource("mempool", "fees");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).toBeNull();
    });
  });

  describe("Blockchain.info", () => {
    it("returns SurgicalCandidate for BTC price claim via ticker", () => {
      const adapter = adapters.get("blockchain-info");
      expect(adapter).toBeDefined();
      expect(adapter!.buildSurgicalUrl).toBeDefined();

      const claim = makeClaim({ entities: ["bitcoin", "BTC"] });
      const source = makeSource("blockchain-info", "ticker");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.url).toContain("blockchain.info/ticker");
      expect(result!.extractionPath).toBe("$.USD.last");
      expect(result!.provider).toBe("blockchain-info");
    });

    it("returns SurgicalCandidate for metric claim via stats", () => {
      const adapter = adapters.get("blockchain-info");
      // Note: extractionPath is $.market_price_usd for ALL metric claims.
      // Non-price metrics (hashrate, difficulty) will false-fail at verification
      // because the extracted value won't match the claim value. This is a known
      // limitation of single-extractionPath-per-operation — acceptable because
      // fail-closed is safer than fail-open. Future: per-metric extractionPaths.
      const claim = makeClaim({ type: "metric", entities: ["bitcoin", "BTC"], text: "BTC market price $84,000", value: 84000, unit: "USD" });
      const source = makeSource("blockchain-info", "stats");
      const result = adapter!.buildSurgicalUrl!(claim, source);

      expect(result).not.toBeNull();
      expect(result!.url).toContain("blockchain.info/stats");
      expect(result!.extractionPath).toBe("$.market_price_usd");
      expect(result!.provider).toBe("blockchain-info");
    });
  });

  describe("YAML spec claimTypes", () => {
    it("binance ticker-price has claimTypes", () => {
      // Verify the spec was loaded correctly by checking surgical URL works
      const adapter = adapters.get("binance");
      const claim = makeClaim();
      const source = makeSource("binance", "ticker-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
    });

    it("coingecko simple-price has claimTypes", () => {
      const adapter = adapters.get("coingecko");
      const claim = makeClaim();
      const source = makeSource("coingecko", "simple-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
    });

    it("etherscan gas-oracle has claimTypes", () => {
      const adapter = adapters.get("etherscan");
      const claim = makeClaim();
      const source = makeSource("etherscan", "gas-oracle");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
    });

    it("yahoo-finance quote has claimTypes", () => {
      const adapter = adapters.get("yahoo-finance");
      const claim = makeClaim();
      const source = makeSource("yahoo-finance", "quote");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
    });

    it("coinbase spot-price has claimTypes", () => {
      const adapter = adapters.get("coinbase");
      const claim = makeClaim();
      const source = makeSource("coinbase", "spot-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
    });

    it("deribit ticker has claimTypes", () => {
      const adapter = adapters.get("deribit");
      const claim = makeClaim();
      const source = makeSource("deribit", "ticker");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
    });

    it("blockchair stats has claimTypes", () => {
      const adapter = adapters.get("blockchair");
      const claim = makeClaim();
      const source = makeSource("blockchair", "stats");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
    });

    it("treasury debt has claimTypes", () => {
      const adapter = adapters.get("treasury");
      const claim = makeClaim({ type: "metric", text: "National debt $34T", entities: ["debt", "treasury"], value: 34000000000000, unit: "USD" });
      const source = makeSource("treasury", "debt");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
    });

    it("coingecko global has claimTypes", () => {
      const adapter = adapters.get("coingecko");
      const claim = makeClaim({ type: "metric", text: "Crypto market cap $2.1T", entities: ["crypto", "market"], value: 2100000000000, unit: "USD" });
      const source = makeSource("coingecko", "global");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
      expect(result!.url).toContain("api.coingecko.com/api/v3/global");
    });

    it("mempool hashrate has claimTypes", () => {
      const adapter = adapters.get("mempool");
      const claim = makeClaim({ type: "metric", text: "Bitcoin hashrate 650 EH/s", entities: ["bitcoin", "hashrate"], value: 650, unit: "EH/s" });
      const source = makeSource("mempool", "hashrate");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
    });

    it("defillama stablecoins has claimTypes", () => {
      const adapter = adapters.get("defillama");
      const claim = makeClaim({ type: "metric", text: "USDT supply $80B", entities: ["usdt", "stablecoin"], value: 80000000000, unit: "USD" });
      const source = makeSource("defillama", "stablecoins");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
    });
  });

  describe("macro entity resolution", () => {
    it("fred builds surgical URL for GDP claim", () => {
      const adapter = adapters.get("fred");
      const claim = makeClaim({ type: "metric", text: "GDP at 3.2%", entities: ["GDP"], value: 3.2, unit: "%" });
      const source = makeSource("fred", "series");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
      expect(result!.url).toContain("series_id=GDP");
    });

    it("worldbank builds surgical URL for GDP claim", () => {
      const adapter = adapters.get("worldbank");
      const claim = makeClaim({ type: "metric", text: "GDP $25T", entities: ["GDP"], value: 25000000000000, unit: "USD" });
      const source = makeSource("worldbank", "indicator");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
      expect(result!.url).toContain("NY.GDP.MKTP.CD");
    });

    it("treasury builds surgical URL for debt claim", () => {
      const adapter = adapters.get("treasury");
      const claim = makeClaim({ type: "metric", text: "National debt $34T", entities: ["national debt"], value: 34000000000000, unit: "USD" });
      const source = makeSource("treasury", "debt");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
      expect(result!.url).toContain("debt_to_penny");
    });

    it("usgs builds surgical URL for earthquake claim", () => {
      const adapter = adapters.get("usgs");
      const claim = makeClaim({ type: "metric", text: "Earthquake magnitude 6.5", entities: ["earthquake"], value: 6.5, unit: "" });
      const source = makeSource("usgs", "significant");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
      expect(result!.url).toContain("significant_week");
    });

    it("crypto entities still work after macro plumbing", () => {
      const adapter = adapters.get("binance");
      const claim = makeClaim();  // default BTC price claim
      const source = makeSource("binance", "ticker-price");
      const result = adapter!.buildSurgicalUrl!(claim, source);
      expect(result).not.toBeNull();
      expect(result!.url).toContain("BTCUSDT");
    });
  });
});
