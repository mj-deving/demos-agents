import { describe, expect, it } from "vitest";

import {
  buildMinimalAttestationPlan,
} from "../../packages/omniweb-toolkit/src/minimal-attestation-plan.js";
import { matchResearchDraftToPlan } from "../../packages/omniweb-toolkit/src/research-source-match.js";

function makeEvidenceRead(url: string) {
  return {
    ok: true as const,
    summary: {
      source: "Binance Futures Premium Index",
      url,
      fetchedAt: "2026-04-18T12:00:00.000Z",
      values: {
        markPrice: "67250.00",
        indexPrice: "67245.12",
        lastFundingRate: "-0.012",
      },
      derivedMetrics: {
        fundingRateBps: "-120",
      },
    },
    prefetchedResponse: {
      url,
      status: 200,
      headers: {
        "content-type": "application/json",
      },
      bodyText: JSON.stringify({
        markPrice: "67250.00",
        indexPrice: "67245.12",
        lastFundingRate: "-0.012",
        interestRate: "0.0001",
      }),
    },
  };
}

describe("matchResearchDraftToPlan", () => {
  it("passes when the draft uses the same evidence and topic context", async () => {
    const plan = buildMinimalAttestationPlan({
      topic: "btc funding rate contrarian",
      preferredSourceIds: ["binance-futures-btc"],
      supportingPreferredSourceIds: ["binance-futures-oi-btc"],
      allowTopicFallback: false,
      minSupportingSources: 0,
    });

    expect(plan.primary).not.toBeNull();
    const result = await matchResearchDraftToPlan({
      topic: "btc funding rate contrarian",
      text: "BTC's derivatives structure is leaning short into a soft tape: funding at -0.012 with mark price near 67,250 and index near 67,245 shows shorts paying to stay short before price has actually broken down.",
      tags: ["research", "coverage-gap"],
      attestationPlan: plan,
      evidenceReads: [makeEvidenceRead(plan.primary!.url)],
    });

    expect(result.pass).toBe(true);
  });

  it("fails when the draft does not align with the attested source evidence", async () => {
    const plan = buildMinimalAttestationPlan({
      topic: "btc funding rate contrarian",
      preferredSourceIds: ["binance-futures-btc"],
      supportingPreferredSourceIds: ["binance-futures-oi-btc"],
      allowTopicFallback: false,
      minSupportingSources: 0,
    });

    expect(plan.primary).not.toBeNull();
    const result = await matchResearchDraftToPlan({
      topic: "btc funding rate contrarian",
      text: "Dogecoin meme velocity is accelerating and retail appetite is clearly back in control of the tape.",
      tags: ["research"],
      attestationPlan: plan,
      evidenceReads: [makeEvidenceRead(plan.primary!.url)],
    });

    expect(result.pass).toBe(false);
  });
});
