import { describe, expect, it } from "vitest";
import {
  buildResearchEvidenceDelta,
  summarizeResearchEvidenceDelta,
} from "../../packages/omniweb-toolkit/src/research-evidence-delta.js";

describe("research evidence delta helpers", () => {
  it("marks percent-based movement as meaningful when it exceeds the default threshold", () => {
    const delta = buildResearchEvidenceDelta(
      {
        currentPriceUsd: "100",
        latestVolumeUsd: "2000",
      },
      {
        currentPriceUsd: "101.5",
        latestVolumeUsd: "2000",
      },
    );

    expect(delta.currentPriceUsd).toEqual({
      current: "101.5",
      previous: "100",
      absoluteChange: 1.5,
      percentChange: 1.5,
    });
    expect(summarizeResearchEvidenceDelta(delta)).toEqual({
      hasMeaningfulChange: true,
      changedFields: ["currentPriceUsd"],
    });
  });

  it("falls back to absolute movement when percent change cannot be computed", () => {
    const delta = buildResearchEvidenceDelta(
      {
        lastFundingRate: "0",
      },
      {
        lastFundingRate: "0.004",
      },
    );

    expect(delta.lastFundingRate.percentChange).toBeNull();
    expect(summarizeResearchEvidenceDelta(delta)).toEqual({
      hasMeaningfulChange: true,
      changedFields: ["lastFundingRate"],
    });
  });

  it("ignores values that stay within the configured normal range", () => {
    const delta = buildResearchEvidenceDelta(
      {
        currentPriceUsd: "100",
        lastFundingRate: "0",
      },
      {
        currentPriceUsd: "100.5",
        lastFundingRate: "0.0005",
      },
    );

    expect(summarizeResearchEvidenceDelta(delta)).toEqual({
      hasMeaningfulChange: false,
      changedFields: [],
    });
  });
});
