import { describe, it, expect } from "vitest";
import { generateTopicAngle } from "../../../src/toolkit/strategy/topic-angle.js";

describe("generateTopicAngle", () => {
  it("returns an angled variant of a signal-aligned topic", () => {
    const angle = generateTopicAngle("Bitcoin ETF demand", {
      originalRule: "publish_signal_aligned",
    });
    expect(angle).not.toBe("Bitcoin ETF demand");
    expect(angle).toBeTruthy();
    // Should contain the core subject
    expect(angle!.toLowerCase()).toContain("bitcoin");
  });

  it("uses oracle divergence data to frame a counter-angle", () => {
    const angle = generateTopicAngle("Bitcoin ETF demand", {
      originalRule: "publish_signal_aligned",
      divergence: {
        asset: "BTC",
        severity: "high",
        agentDirection: "bullish",
        marketDirection: "neutral",
      },
    });
    expect(angle).toBeTruthy();
    // Should reference the tension/divergence
    expect(angle!.toLowerCase()).toMatch(/diverge|tension|contrast|split|disagree|vs/);
  });

  it("generates a sub-topic angle when expansion map has entries", () => {
    const angle = generateTopicAngle("crypto market overview", {
      originalRule: "publish_to_gaps",
      expansions: { crypto: ["bitcoin", "ethereum", "stablecoins"] },
    });
    expect(angle).toBeTruthy();
    // Should pick a specific sub-topic
    expect(["bitcoin", "ethereum", "stablecoins"].some(
      (sub) => angle!.toLowerCase().includes(sub),
    )).toBe(true);
  });

  it("adds temporal framing when no other context is available", () => {
    const angle = generateTopicAngle("Aave lending rates", {
      originalRule: "publish_signal_aligned",
    });
    expect(angle).toBeTruthy();
    expect(angle).not.toBe("Aave lending rates");
  });

  it("returns null for topics too short to angle", () => {
    const angle = generateTopicAngle("btc", {
      originalRule: "publish_signal_aligned",
    });
    expect(angle).toBeNull();
  });

  it("returns null when the topic is a single generic word", () => {
    const angle = generateTopicAngle("crypto", {
      originalRule: "publish_signal_aligned",
    });
    // Generic single-word topics can use expansion
    // but without expansions context, should return null
    expect(angle).toBeNull();
  });

  it("does not repeat the original topic verbatim", () => {
    for (let i = 0; i < 10; i++) {
      const angle = generateTopicAngle("Ethereum staking yields", {
        originalRule: "publish_signal_aligned",
      });
      if (angle) {
        expect(angle).not.toBe("Ethereum staking yields");
      }
    }
  });
});
