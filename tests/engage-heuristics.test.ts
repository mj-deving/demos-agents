import { describe, it, expect } from "vitest";
import { selectReaction, enforceDisagreeMinimum } from "../src/lib/engage-heuristics.js";

describe("selectReaction", () => {
  const ourAddress = "0xABCD1234";
  const qualityFloor = 70;

  it("returns agree for attested high-score post", () => {
    const post = {
      author: "0xOTHER",
      txHash: "tx123",
      myReaction: null,
      payload: {
        sourceAttestations: [{ url: "https://example.com" }],
        cat: "ANALYSIS",
        text: "BTC at $67,432 today",
      },
      score: 85,
    };

    const result = selectReaction(post, ourAddress, qualityFloor);
    expect(result).not.toBeNull();
    expect(result!.reaction).toBe("agree");
    expect(result!.reason).toContain("attested");
  });

  it("returns agree for attested ANALYSIS post at quality floor", () => {
    const post = {
      author: "0xOTHER",
      txHash: "tx456",
      myReaction: null,
      payload: {
        sourceAttestations: [{ url: "https://example.com" }],
        cat: "ANALYSIS",
        text: "Market analysis shows consolidation",
      },
      score: 72,
    };

    const result = selectReaction(post, ourAddress, qualityFloor);
    expect(result).not.toBeNull();
    expect(result!.reaction).toBe("agree");
    expect(result!.reason).toContain("ANALYSIS");
  });

  it("returns disagree for unattested post with numeric claim", () => {
    const post = {
      author: "0xOTHER",
      txHash: "tx789",
      myReaction: null,
      payload: {
        sourceAttestations: [],
        cat: "ANALYSIS",
        text: "BTC rose 15.2% this week without any source",
      },
      score: 75,
    };

    const result = selectReaction(post, ourAddress, qualityFloor);
    expect(result).not.toBeNull();
    expect(result!.reaction).toBe("disagree");
    expect(result!.reason).toContain("unattested");
  });

  it("returns null for own posts", () => {
    const post = {
      author: ourAddress,
      txHash: "tx000",
      myReaction: null,
      payload: { sourceAttestations: [{ url: "x" }], cat: "ANALYSIS", text: "My post" },
      score: 90,
    };

    const result = selectReaction(post, ourAddress, qualityFloor);
    expect(result).toBeNull();
  });

  it("returns null for posts below quality floor", () => {
    const post = {
      author: "0xOTHER",
      txHash: "tx111",
      myReaction: null,
      payload: { sourceAttestations: [{ url: "x" }], cat: "ANALYSIS", text: "Stuff" },
      score: 50,
    };

    const result = selectReaction(post, ourAddress, qualityFloor);
    expect(result).toBeNull();
  });

  it("returns null for already-reacted posts", () => {
    const post = {
      author: "0xOTHER",
      txHash: "tx222",
      myReaction: "agree",
      payload: { sourceAttestations: [{ url: "x" }], cat: "ANALYSIS", text: "Good post" },
      score: 90,
    };

    const result = selectReaction(post, ourAddress, qualityFloor);
    expect(result).toBeNull();
  });

  it("returns null for posts without txHash", () => {
    const post = {
      author: "0xOTHER",
      txHash: "",
      myReaction: null,
      payload: { sourceAttestations: [{ url: "x" }], cat: "ANALYSIS", text: "No hash" },
      score: 90,
    };

    const result = selectReaction(post, ourAddress, qualityFloor);
    expect(result).toBeNull();
  });
});

describe("enforceDisagreeMinimum", () => {
  const ourAddress = "0xABCD1234";
  const qualityFloor = 70;

  it("returns empty when disagree minimum already met", () => {
    const remainingPosts: any[] = [
      {
        author: "0xOTHER",
        txHash: "txR1",
        myReaction: null,
        payload: { sourceAttestations: [], cat: "ANALYSIS", text: "BTC at 15.2% gain" },
        score: 75,
      },
    ];

    const result = enforceDisagreeMinimum({
      remainingPosts,
      currentDisagrees: 1,
      minDisagreePerSession: 1,
      ourAddress,
      qualityFloor,
    });

    expect(result).toHaveLength(0);
  });

  it("finds disagree-eligible targets from remaining posts", () => {
    const remainingPosts: any[] = [
      {
        author: "0xOTHER",
        txHash: "txR1",
        myReaction: null,
        payload: { sourceAttestations: [], cat: "ANALYSIS", text: "BTC surged 42.5% in one day" },
        score: 75,
      },
      {
        author: "0xOTHER2",
        txHash: "txR2",
        myReaction: null,
        payload: { sourceAttestations: [{ url: "x" }], cat: "ANALYSIS", text: "Attested post score 90" },
        score: 90,
      },
    ];

    const result = enforceDisagreeMinimum({
      remainingPosts,
      currentDisagrees: 0,
      minDisagreePerSession: 1,
      ourAddress,
      qualityFloor,
    });

    expect(result).toHaveLength(1);
    expect(result[0].reaction).toBe("disagree");
    expect(result[0].txHash).toBe("txR1");
  });

  it("caps additional disagrees at deficit amount", () => {
    const remainingPosts: any[] = [
      {
        author: "0xA",
        txHash: "txD1",
        myReaction: null,
        payload: { sourceAttestations: [], cat: "ANALYSIS", text: "Price up 10%" },
        score: 75,
      },
      {
        author: "0xB",
        txHash: "txD2",
        myReaction: null,
        payload: { sourceAttestations: [], cat: "ANALYSIS", text: "Volume up 25%" },
        score: 80,
      },
      {
        author: "0xC",
        txHash: "txD3",
        myReaction: null,
        payload: { sourceAttestations: [], cat: "ANALYSIS", text: "TVL grew 33.5%" },
        score: 72,
      },
    ];

    const result = enforceDisagreeMinimum({
      remainingPosts,
      currentDisagrees: 0,
      minDisagreePerSession: 2,
      ourAddress,
      qualityFloor,
    });

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.reaction === "disagree")).toBe(true);
  });

  it("returns empty array and logs warning when no eligible posts", () => {
    const remainingPosts: any[] = [
      {
        author: "0xOTHER",
        txHash: "txR3",
        myReaction: null,
        payload: { sourceAttestations: [{ url: "x" }], cat: "ANALYSIS", text: "Attested post" },
        score: 90,
      },
    ];

    const result = enforceDisagreeMinimum({
      remainingPosts,
      currentDisagrees: 0,
      minDisagreePerSession: 1,
      ourAddress,
      qualityFloor,
    });

    expect(result).toHaveLength(0);
  });

  it("integration: all-agree main loop triggers second pass disagree", () => {
    // Simulates: main loop used all 5 slots for agrees (no disagrees)
    // Second pass should find disagree targets in remaining posts
    const allPosts: any[] = [
      // First 5 posts = attested high-score (main loop agrees)
      ...Array.from({ length: 5 }, (_, i) => ({
        author: `0xAgree${i}`,
        txHash: `txAgree${i}`,
        myReaction: null,
        payload: { sourceAttestations: [{ url: "x" }], cat: "ANALYSIS", text: `Attested post ${i}` },
        score: 85,
      })),
      // Remaining posts = unattested numeric claims (disagree-eligible)
      {
        author: "0xDisagree1",
        txHash: "txDisagree1",
        myReaction: null,
        payload: { sourceAttestations: [], cat: "ANALYSIS", text: "Unverified: BTC up 50.3% to $100k" },
        score: 75,
      },
    ];

    // Simulate main loop: select first 5 as agrees
    const mainLoopProcessed: string[] = [];
    let agrees = 0;
    let disagrees = 0;
    const maxReactions = 5;

    for (const post of allPosts) {
      if (agrees + disagrees >= maxReactions) break;
      const decision = selectReaction(post, ourAddress, qualityFloor);
      if (decision) {
        mainLoopProcessed.push(post.txHash);
        if (decision.reaction === "agree") agrees++;
        else disagrees++;
      }
    }

    expect(agrees).toBe(5);
    expect(disagrees).toBe(0);

    // Second pass on remaining unprocessed posts
    const remaining = allPosts.filter((p) => !mainLoopProcessed.includes(p.txHash));
    const additionalDisagrees = enforceDisagreeMinimum({
      remainingPosts: remaining,
      currentDisagrees: disagrees,
      minDisagreePerSession: 1,
      ourAddress,
      qualityFloor,
    });

    expect(additionalDisagrees).toHaveLength(1);
    expect(additionalDisagrees[0].reaction).toBe("disagree");
    expect(additionalDisagrees[0].txHash).toBe("txDisagree1");
  });
});
