import { describe, expect, it } from "vitest";

import {
  hasRecordedTip,
  normalizeBalance,
  normalizeReactionEnvelope,
  normalizeTipReadback,
  parentThreadContainsReply,
  reactionReadbackSatisfied,
  selectSocialWriteCandidate,
  tipReadbackSatisfied,
} from "../../packages/omniweb-toolkit/scripts/_write-proof-shared";

describe("social-write-proof helpers", () => {
  it("selects the first external post with text and tx hash", () => {
    const candidate = selectSocialWriteCandidate(
      [
        { txHash: "own-1", author: "0xSELF", payload: { text: "skip me" } },
        { txHash: "ext-1", author: "0xOther", payload: { text: "hello from feed", cat: "ANALYSIS" }, score: 92 },
      ],
      "0xself",
    );

    expect(candidate).toEqual({
      txHash: "ext-1",
      author: "0xOther",
      text: "hello from feed",
      category: "ANALYSIS",
      score: 92,
    });
  });

  it("accepts snake_case tx_hash feed payloads", () => {
    const candidate = selectSocialWriteCandidate(
      [
        { tx_hash: "ext-2", author: "0xOther", payload: { text: "snake case hash" } },
      ],
      "0xself",
    );

    expect(candidate?.txHash).toBe("ext-2");
  });

  it("accepts reaction readback via myReaction or count delta", () => {
    expect(
      reactionReadbackSatisfied(
        normalizeReactionEnvelope({ agree: 1, disagree: 0, flag: 0 }),
        normalizeReactionEnvelope({ agree: 1, disagree: 0, flag: 0, myReaction: "agree" }),
        "agree",
      ),
    ).toBe(true);

    expect(
      reactionReadbackSatisfied(
        normalizeReactionEnvelope({ agree: 1, disagree: 0, flag: 0 }),
        normalizeReactionEnvelope({ agree: 2, disagree: 0, flag: 0 }),
        "agree",
      ),
    ).toBe(true);
  });

  it("accepts tip readback via myTip, aggregate delta, or balance delta", () => {
    expect(
      tipReadbackSatisfied(
        normalizeTipReadback({ totalTips: 1, totalDem: 2 }),
        normalizeTipReadback({ totalTips: 1, totalDem: 2, myTip: 1 }),
        10,
        9,
        1,
      ),
    ).toBe(true);

    expect(
      tipReadbackSatisfied(
        normalizeTipReadback({ totalTips: 1, totalDem: 2 }),
        normalizeTipReadback({ totalTips: 2, totalDem: 3 }),
        10,
        10,
        1,
      ),
    ).toBe(true);

    expect(
      tipReadbackSatisfied(
        normalizeTipReadback({ totalTips: 1, totalDem: 2 }),
        normalizeTipReadback({ totalTips: 1, totalDem: 2 }),
        normalizeBalance("10"),
        normalizeBalance("8.8"),
        1,
      ),
    ).toBe(true);
  });

  it("does not treat zero-valued myTip as a successful tip readback", () => {
    expect(hasRecordedTip(0)).toBe(false);
    expect(hasRecordedTip("0")).toBe(false);
    expect(hasRecordedTip(1)).toBe(true);
  });

  it("requires a new myTip delta when a post was already tipped", () => {
    expect(
      tipReadbackSatisfied(
        normalizeTipReadback({ totalTips: 1, totalDem: 2, myTip: 2 }),
        normalizeTipReadback({ totalTips: 1, totalDem: 2, myTip: 2 }),
        normalizeBalance("10"),
        normalizeBalance("10"),
        1,
      ),
    ).toBe(false);
  });

  it("detects a reply in parent thread detail", () => {
    expect(parentThreadContainsReply({ replies: [{ txHash: "reply-1" }, { txHash: "reply-2" }] }, "reply-2")).toBe(true);
    expect(parentThreadContainsReply({ replies: [{ txHash: "reply-1" }] }, "reply-2")).toBe(false);
  });
});
