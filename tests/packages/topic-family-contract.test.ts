import { describe, expect, it } from "vitest";
import {
  createTopicFamilyRegistry,
  defineTopicFamilyContract,
  getTopicFamilyContract,
} from "../../packages/omniweb-toolkit/src/topic-family-contract.js";
import {
  defineResearchTopicFamilyContract,
  getResearchTopicFamilyContract,
} from "../../packages/omniweb-toolkit/src/research-family-contracts.js";

describe("topic-family contract foundation", () => {
  it("builds a registry from typed family contracts", () => {
    const contract = defineTopicFamilyContract({
      family: "oracle-divergence",
      displayName: "Oracle Divergence",
      sourcePlan: {
        primarySourceIds: ["coingecko-42ff8c85"],
        supportingSourceIds: ["coingecko-2a7ea372"],
        expectedMetrics: ["currentPriceUsd", "priceChangePercent7d"],
      },
      promptDoctrine: {
        baseline: ["Divergence is descriptive, not predictive."],
        focus: ["Name what disagrees and what would resolve it."],
      },
      claimBounds: {
        defensible: ["Describe the mismatch between colony sentiment and price action."],
        blocked: ["Do not call the divergence a tradeable edge."],
        requiresExtra: [
          {
            claim: "Independent consensus strength",
            requiredMetrics: ["modelDiversityScore"],
            reason: "Agent count is not enough to prove independent agreement.",
          },
        ],
      },
      metricSemantics: {
        currentPriceUsd: {
          means: "Observed spot price in USD for the asset at fetch time.",
          doesNotMean: "Directional confirmation by itself.",
        },
      },
      quality: {
        slipPatterns: [
          {
            pattern: /\bedge\b/i,
            detail: "edge language is not allowed for a descriptive divergence.",
          },
        ],
      },
    });

    const registry = createTopicFamilyRegistry([contract]);

    expect(getTopicFamilyContract(registry, "oracle-divergence")).toBe(contract);
    expect(registry["oracle-divergence"].metricSemantics.currentPriceUsd.doesNotMean)
      .toContain("Directional confirmation");
  });

  it("rejects duplicate family ids in a registry", () => {
    const contract = defineTopicFamilyContract({
      family: "oracle-divergence",
      displayName: "Oracle Divergence",
      sourcePlan: {
        primarySourceIds: [],
        supportingSourceIds: [],
        expectedMetrics: [],
      },
      promptDoctrine: {
        baseline: [],
        focus: [],
      },
      claimBounds: {
        defensible: [],
        blocked: [],
        requiresExtra: [],
      },
      metricSemantics: {},
      quality: {
        slipPatterns: [],
      },
    });

    expect(() => createTopicFamilyRegistry([contract, contract])).toThrow(
      "duplicate_topic_family_contract:oracle-divergence",
    );
  });

  it("allows family ids that would collide with plain-object prototype keys", () => {
    const contract = defineTopicFamilyContract({
      family: "toString",
      displayName: "Prototype Key Contract",
      sourcePlan: {
        primarySourceIds: [],
        supportingSourceIds: [],
        expectedMetrics: [],
      },
      promptDoctrine: {
        baseline: [],
        focus: [],
      },
      claimBounds: {
        defensible: [],
        blocked: [],
        requiresExtra: [],
      },
      metricSemantics: {},
      quality: {
        slipPatterns: [],
      },
    });

    const registry = createTopicFamilyRegistry([contract]);
    expect(getTopicFamilyContract(registry, "toString")).toBe(contract);
  });

  it("provides a research-family-specific helper without allowing unsupported", () => {
    const contract = defineResearchTopicFamilyContract({
      family: "funding-structure",
      displayName: "Funding Structure",
      sourcePlan: {
        primarySourceIds: ["binance-futures-btc"],
        supportingSourceIds: ["binance-futures-oi-btc"],
        expectedMetrics: ["lastFundingRate", "openInterest"],
      },
      promptDoctrine: {
        baseline: ["Funding is a positioning snapshot."],
        focus: ["Relate funding to price and open interest."],
      },
      claimBounds: {
        defensible: ["Positioning stress."],
        blocked: ["Funding predicts direction by itself."],
        requiresExtra: [],
      },
      metricSemantics: {
        lastFundingRate: {
          means: "Periodic cost of holding the perpetual side that is paying funding.",
          doesNotMean: "Future price direction prediction by itself.",
        },
      },
      quality: {
        slipPatterns: [],
      },
    });

    expect(contract.family).toBe("funding-structure");
  });

  it("exposes contract-backed brief doctrine and slip patterns for shipped research families", () => {
    const contract = getResearchTopicFamilyContract("network-activity");

    expect(contract.promptDoctrine.baseline[0]).toContain("High on-chain activity is context");
    expect(contract.claimBounds.blocked[0]).toContain("more transactions by themselves");
    expect(contract.researchBrief.allowedThesisSpace).toContain("descriptively about network conditions");
    expect(contract.quality.slipPatterns.some((entry) => entry.pattern.test(
      "price action validates the network load",
    ))).toBe(true);
  });
});
