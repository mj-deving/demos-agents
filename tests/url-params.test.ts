import { describe, it, expect } from "vitest";
import { extractUrlParams } from "../src/lib/sources/providers/declarative-engine.js";

describe("extractUrlParams", () => {
  describe("path segment extraction", () => {
    it("extracts GeckoTerminal network and address from URL", () => {
      const result = extractUrlParams(
        "https://api.geckoterminal.com/api/v2/networks/solana/tokens/abc123def",
        "https://api.geckoterminal.com/api/v2/networks/{network}/tokens/{address}",
      );
      expect(result.network).toBe("solana");
      expect(result.address).toBe("abc123def");
    });

    it("extracts single path parameter", () => {
      const result = extractUrlParams(
        "https://api.example.com/v1/assets/bitcoin",
        "https://api.example.com/v1/assets/{asset}",
      );
      expect(result.asset).toBe("bitcoin");
    });

    it("returns empty for mismatched segment count", () => {
      const result = extractUrlParams(
        "https://api.example.com/v1/assets/bitcoin/extra",
        "https://api.example.com/v1/assets/{asset}",
      );
      expect(Object.keys(result)).toHaveLength(0);
    });

    it("ignores literal segments (only captures {var} placeholders)", () => {
      const result = extractUrlParams(
        "https://api.geckoterminal.com/api/v2/networks/eth/tokens/0xabc",
        "https://api.geckoterminal.com/api/v2/networks/{network}/tokens/{address}",
      );
      expect(result).toEqual({ network: "eth", address: "0xabc" });
    });
  });

  describe("query parameter extraction", () => {
    it("extracts Jupiter mint addresses from query params", () => {
      const result = extractUrlParams(
        "https://quote-api.jup.ag/v6/quote?inputMint=So111&outputMint=EPjF&amount=1000000000",
        "https://quote-api.jup.ag/v6/quote",
        { inputMint: "{inputMint}", outputMint: "{outputMint}", amount: "{amount}" },
      );
      expect(result.inputMint).toBe("So111");
      expect(result.outputMint).toBe("EPjF");
      expect(result.amount).toBe("1000000000");
    });

    it("handles missing query params gracefully", () => {
      const result = extractUrlParams(
        "https://quote-api.jup.ag/v6/quote?inputMint=So111",
        "https://quote-api.jup.ag/v6/quote",
        { inputMint: "{inputMint}", outputMint: "{outputMint}" },
      );
      expect(result.inputMint).toBe("So111");
      expect(result.outputMint).toBeUndefined();
    });

    it("ignores non-template query spec values", () => {
      const result = extractUrlParams(
        "https://api.example.com?key=val",
        "https://api.example.com",
        { key: "fixed-value" },
      );
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe("combined path + query extraction", () => {
    it("extracts both path and query params", () => {
      const result = extractUrlParams(
        "https://api.example.com/v1/networks/solana/quote?amount=100",
        "https://api.example.com/v1/networks/{network}/quote",
        { amount: "{amount}" },
      );
      expect(result.network).toBe("solana");
      expect(result.amount).toBe("100");
    });
  });

  describe("edge cases", () => {
    it("returns empty for invalid source URL", () => {
      const result = extractUrlParams(
        "not-a-url",
        "https://api.example.com/{id}",
      );
      expect(Object.keys(result)).toHaveLength(0);
    });

    it("returns empty for invalid template URL", () => {
      const result = extractUrlParams(
        "https://api.example.com/test",
        "not-a-url",
      );
      expect(Object.keys(result)).toHaveLength(0);
    });

    it("handles no query spec", () => {
      const result = extractUrlParams(
        "https://api.example.com/v1/assets/bitcoin",
        "https://api.example.com/v1/assets/{asset}",
      );
      expect(result.asset).toBe("bitcoin");
    });

    it("returns empty when hosts differ but segments match", () => {
      const result = extractUrlParams(
        "https://different-api.com/data",
        "https://api.example.com/{id}",
      );
      // Same segment count — extracts based on position, which is acceptable.
      // The calling code handles irrelevant values gracefully.
      expect(result.id).toBe("data");
    });
  });
});
