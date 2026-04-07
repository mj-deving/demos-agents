import { describe, expect, it } from "vitest";
import { expandTopic } from "../../../src/toolkit/strategy/topic-expansion.js";

describe("expandTopic", () => {
  it("expands 'ai' to specific sub-topics", () => {
    const result = expandTopic("ai");
    expect(result).toEqual(["ai-infrastructure", "ai-safety", "ai-regulation"]);
  });

  it("expands 'defi' to specific sub-topics", () => {
    const result = expandTopic("defi");
    expect(result).toEqual(["defi-lending", "defi-yield", "defi-governance"]);
  });

  it("expands 'crypto' to specific sub-topics", () => {
    const result = expandTopic("crypto");
    expect(result).toEqual(["bitcoin", "ethereum", "stablecoins"]);
  });

  it("expands 'macro' to specific sub-topics", () => {
    const result = expandTopic("macro");
    expect(result).toEqual(["monetary-policy", "inflation", "trade-policy"]);
  });

  it("expands 'security' to specific sub-topics", () => {
    const result = expandTopic("security");
    expect(result).toEqual(["smart-contract-security", "protocol-exploits", "audit-findings"]);
  });

  it("returns [topic] when no match found", () => {
    const result = expandTopic("unknown-topic");
    expect(result).toEqual(["unknown-topic"]);
  });

  it("is case-insensitive", () => {
    expect(expandTopic("AI")).toEqual(["ai-infrastructure", "ai-safety", "ai-regulation"]);
    expect(expandTopic("DeFi")).toEqual(["defi-lending", "defi-yield", "defi-governance"]);
    expect(expandTopic("CRYPTO")).toEqual(["bitcoin", "ethereum", "stablecoins"]);
  });

  it("allows custom expansions to override defaults", () => {
    const custom = { ai: ["llm-ops", "ml-safety"] };
    const result = expandTopic("ai", custom);
    expect(result).toEqual(["llm-ops", "ml-safety"]);
  });

  it("falls back to defaults when custom has no match", () => {
    const custom = { nft: ["nft-art", "nft-gaming"] };
    const result = expandTopic("ai", custom);
    expect(result).toEqual(["ai-infrastructure", "ai-safety", "ai-regulation"]);
  });

  it("uses custom expansion for new keys not in defaults", () => {
    const custom = { gaming: ["esports", "p2e"] };
    const result = expandTopic("gaming", custom);
    expect(result).toEqual(["esports", "p2e"]);
  });

  it("returns [topic] when no match in either custom or defaults", () => {
    const custom = { gaming: ["esports"] };
    const result = expandTopic("weather", custom);
    expect(result).toEqual(["weather"]);
  });
});
