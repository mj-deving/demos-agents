/**
 * Tests for the 10 evidence extractors (ADR-0020 categories).
 *
 * Each extractor maps one evidence category to API primitives
 * and returns AvailableEvidence[].
 */
import { describe, it, expect } from "vitest";
import type { Toolkit } from "../../../src/toolkit/primitives/types.js";
import type { AvailableEvidence } from "../../../src/toolkit/colony/available-evidence.js";
import {
  extractColonyFeeds,
  extractColonySignals,
  extractThreads,
  extractEngagement,
  extractOracle,
  extractLeaderboard,
  extractPrices,
  extractPredictions,
  extractVerification,
  extractNetwork,
  EXTRACTOR_REGISTRY,
} from "../../../src/toolkit/observe/extractors/index.js";
import type { EvidenceExtractor } from "../../../src/toolkit/observe/extractors/index.js";

// ── Mock helpers ─────────────────────────────────────

/** Default error result for all primitives */
const fail = { ok: false as const, status: 500, error: "mock error" };

function stubNamespace<T extends Record<string, unknown>>(overrides: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop in overrides) return (overrides as Record<string | symbol, unknown>)[prop];
      return () => Promise.resolve(fail);
    },
  });
}

function createMockToolkit(overrides: Partial<Record<keyof Toolkit, unknown>> = {}): Toolkit {
  const namespaces: Array<keyof Toolkit> = [
    "feed", "intelligence", "scores", "agents", "actions",
    "oracle", "prices", "verification", "predictions", "ballot",
    "webhooks", "identity", "balance", "health", "stats",
  ];
  const tk = {} as Record<string, unknown>;
  for (const ns of namespaces) {
    tk[ns] = overrides[ns] ?? stubNamespace();
  }
  return tk as Toolkit;
}

// ── colony-feeds ─────────────────────────────────────

describe("extractColonyFeeds", () => {
  it("maps feed posts to AvailableEvidence", async () => {
    const now = Date.now();
    const tk = createMockToolkit({
      feed: stubNamespace({
        getRecent: () => Promise.resolve({
          ok: true as const,
          data: {
            posts: [
              { txHash: "0xabc", author: "0x1", timestamp: now - 3600_000, payload: { text: "BTC is pumping hard today with strong momentum", cat: "FEED" } },
              { txHash: "0xdef", author: "0x2", timestamp: now - 7200_000, payload: { text: "ETH update", cat: "ANALYSIS" } },
            ],
            hasMore: false,
          },
        }),
      }),
    });

    const evidence = await extractColonyFeeds(tk);
    expect(evidence).toHaveLength(2);
    expect(evidence[0].sourceId).toBe("feed-0xabc");
    expect(evidence[0].subject).toBe("BTC is pumping hard today with strong momentum");
    expect(evidence[0].metrics).toEqual(["FEED"]);
    expect(evidence[0].stale).toBe(false);
    expect(evidence[0].freshness).toBeGreaterThan(0);
    expect(evidence[0].richness).toBeGreaterThan(0);
    expect(evidence[0].richness).toBeLessThanOrEqual(95);
  });

  it("returns [] on API failure", async () => {
    const tk = createMockToolkit();
    expect(await extractColonyFeeds(tk)).toEqual([]);
  });

  it("returns [] on null API result", async () => {
    const tk = createMockToolkit({
      feed: stubNamespace({ getRecent: () => Promise.resolve(null) }),
    });
    expect(await extractColonyFeeds(tk)).toEqual([]);
  });
});

// ── colony-signals ───────────────────────────────────

describe("extractColonySignals", () => {
  it("maps signals to AvailableEvidence", async () => {
    const tk = createMockToolkit({
      intelligence: stubNamespace({
        getSignals: () => Promise.resolve({
          ok: true as const,
          data: [
            { topic: "BTC bullish", consensus: true, direction: "up", agentCount: 5, totalAgents: 10, confidence: 0.8, text: "Consensus is bullish on Bitcoin with strong support" },
            { topic: "ETH bearish", consensus: false, direction: "down", agentCount: 3, totalAgents: 10, confidence: 0.6, text: "Mixed signals on Ethereum price direction" },
          ],
        }),
      }),
    });

    const evidence = await extractColonySignals(tk);
    expect(evidence).toHaveLength(2);
    expect(evidence[0].sourceId).toBe("signal-BTC bullish");
    expect(evidence[0].metrics).toContain("consensus");
    expect(evidence[1].metrics).toContain("no-consensus");
  });

  it("returns [] on API failure", async () => {
    const tk = createMockToolkit();
    expect(await extractColonySignals(tk)).toEqual([]);
  });
});

// ── threads ──────────────────────────────────────────

describe("extractThreads", () => {
  it("maps thread posts to AvailableEvidence", async () => {
    const now = Date.now();
    const tk = createMockToolkit({
      feed: stubNamespace({
        search: () => Promise.resolve({
          ok: true as const,
          data: {
            posts: [
              { txHash: "0xthread1", author: "0x1", timestamp: now - 1800_000, payload: { text: "What is the future of DeFi lending protocols?", cat: "QUESTION" } },
            ],
            hasMore: false,
          },
        }),
      }),
    });

    const evidence = await extractThreads(tk);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sourceId).toBe("thread-0xthread1");
    expect(evidence[0].metrics).toEqual(["QUESTION"]);
  });

  it("returns [] on API failure", async () => {
    const tk = createMockToolkit();
    expect(await extractThreads(tk)).toEqual([]);
  });
});

// ── engagement ───────────────────────────────────────

describe("extractEngagement", () => {
  it("maps leaderboard agents to engagement evidence", async () => {
    const tk = createMockToolkit({
      scores: stubNamespace({
        getLeaderboard: () => Promise.resolve({
          ok: true as const,
          data: {
            agents: [
              { address: "0xAgent1", name: "TopAgent", totalPosts: 100, avgScore: 85, bayesianScore: 80, topScore: 99, lowScore: 20, lastActiveAt: Date.now() - 3600_000 },
            ],
            count: 1,
            globalAvg: 60,
            confidenceThreshold: 5,
          },
        }),
      }),
    });

    const evidence = await extractEngagement(tk);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sourceId).toBe("engagement-0xAgent1");
    expect(evidence[0].subject).toBe("TopAgent");
    expect(evidence[0].metrics).toContain("avgScore:85");
  });

  it("returns [] on API failure", async () => {
    const tk = createMockToolkit();
    expect(await extractEngagement(tk)).toEqual([]);
  });
});

// ── oracle ───────────────────────────────────────────

describe("extractOracle", () => {
  it("maps oracle assets and divergences to evidence", async () => {
    const tk = createMockToolkit({
      oracle: stubNamespace({
        get: () => Promise.resolve({
          ok: true as const,
          data: {
            assets: [
              { ticker: "BTC", postCount: 50, price: { usd: 65000, change24h: 2.5, high24h: 66000, low24h: 63000 }, sentiment: { direction: "up", score: 0.75 } },
            ],
            divergences: [
              { type: "agents_vs_market", asset: "ETH", description: "Agent consensus diverges from market trend", severity: "high" as const },
            ],
            overallSentiment: { direction: "up", score: 0.7, agentCount: 10, topAssets: ["BTC"] },
          },
        }),
      }),
    });

    const evidence = await extractOracle(tk);
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    const btcEvidence = evidence.find(e => e.sourceId === "oracle-BTC");
    expect(btcEvidence).toBeDefined();
    expect(btcEvidence!.metrics).toContain("price:65000");
    const divEvidence = evidence.find(e => e.sourceId.startsWith("divergence-"));
    expect(divEvidence).toBeDefined();
    expect(divEvidence!.metrics).toContain("severity:high");
  });

  it("returns [] on API failure", async () => {
    const tk = createMockToolkit();
    expect(await extractOracle(tk)).toEqual([]);
  });
});

// ── leaderboard ──────────────────────────────────────

describe("extractLeaderboard", () => {
  it("maps leaderboard to agent performance evidence", async () => {
    const tk = createMockToolkit({
      scores: stubNamespace({
        getLeaderboard: () => Promise.resolve({
          ok: true as const,
          data: {
            agents: [
              { address: "0xA1", name: "Agent1", totalPosts: 200, avgScore: 90, bayesianScore: 88, topScore: 100, lowScore: 30, lastActiveAt: Date.now() },
              { address: "0xA2", name: "Agent2", totalPosts: 50, avgScore: 70, bayesianScore: 65, topScore: 85, lowScore: 10, lastActiveAt: Date.now() },
            ],
            count: 2,
            globalAvg: 60,
            confidenceThreshold: 5,
          },
        }),
      }),
    });

    const evidence = await extractLeaderboard(tk);
    expect(evidence).toHaveLength(2);
    expect(evidence[0].sourceId).toBe("leaderboard-0xA1");
    expect(evidence[0].metrics).toContain("posts:200");
    expect(evidence[0].metrics).toContain("bayesian:88");
  });

  it("returns [] on API failure", async () => {
    const tk = createMockToolkit();
    expect(await extractLeaderboard(tk)).toEqual([]);
  });
});

// ── prices ───────────────────────────────────────────

describe("extractPrices", () => {
  it("maps price data to evidence", async () => {
    const tk = createMockToolkit({
      prices: stubNamespace({
        get: () => Promise.resolve({
          ok: true as const,
          data: [
            { ticker: "BTC", priceUsd: 65000, change24h: 2.5, high24h: 66000, low24h: 63000, volume24h: 1e9, marketCap: 1.2e12, fetchedAt: Date.now(), source: "coingecko" },
          ],
        }),
      }),
    });

    const evidence = await extractPrices(tk);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sourceId).toBe("price-BTC");
    expect(evidence[0].metrics).toContain("usd:65000");
    expect(evidence[0].metrics).toContain("change24h:2.5");
  });

  it("returns [] on API failure", async () => {
    const tk = createMockToolkit();
    expect(await extractPrices(tk)).toEqual([]);
  });
});

// ── predictions ──────────────────────────────────────

describe("extractPredictions", () => {
  it("maps predictions to evidence", async () => {
    const tk = createMockToolkit({
      predictions: stubNamespace({
        query: () => Promise.resolve({
          ok: true as const,
          data: [
            { txHash: "0xpred1", author: "0x1", asset: "BTC", predictedPrice: 70000, status: "pending" as const },
            { txHash: "0xpred2", author: "0x2", asset: "ETH", predictedPrice: 4000, actualPrice: 3900, accuracy: 97, status: "correct" as const },
          ],
        }),
      }),
    });

    const evidence = await extractPredictions(tk);
    expect(evidence).toHaveLength(2);
    expect(evidence[0].sourceId).toBe("prediction-0xpred1");
    expect(evidence[0].subject).toBe("BTC");
    expect(evidence[0].metrics).toContain("status:pending");
    expect(evidence[1].metrics).toContain("accuracy:97");
  });

  it("returns [] on API failure", async () => {
    const tk = createMockToolkit();
    expect(await extractPredictions(tk)).toEqual([]);
  });
});

// ── verification ─────────────────────────────────────

describe("extractVerification", () => {
  it("maps network stats to verification evidence", async () => {
    const tk = createMockToolkit({
      stats: stubNamespace({
        get: () => Promise.resolve({
          ok: true as const,
          data: {
            network: { totalPosts: 10000, totalAgents: 50, totalTransactions: 20000 },
            activity: { postsLast24h: 500, activeAgentsLast24h: 30, reactionsLast24h: 200 },
            quality: { avgScore: 72, attestationRate: 0.85 },
            predictions: { total: 300, accuracy: 0.68 },
            tips: { totalDem: 50000, uniqueTippers: 20 },
            consensus: { activeTopics: 15, avgAgentsPerTopic: 4 },
            content: { categoryBreakdown: { ANALYSIS: 400, PREDICTION: 200 } },
            computedAt: new Date().toISOString(),
          },
        }),
      }),
    });

    const evidence = await extractVerification(tk);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sourceId).toBe("verification-stats");
    expect(evidence[0].metrics).toContain("attestationRate:0.85");
    expect(evidence[0].metrics).toContain("avgScore:72");
  });

  it("returns [] on API failure", async () => {
    const tk = createMockToolkit();
    expect(await extractVerification(tk)).toEqual([]);
  });
});

// ── network ──────────────────────────────────────────

describe("extractNetwork", () => {
  it("combines health + stats into network evidence", async () => {
    const now = Date.now();
    const tk = createMockToolkit({
      health: stubNamespace({
        check: () => Promise.resolve({
          ok: true as const,
          data: { status: "ok" as const, uptime: 86400, timestamp: now },
        }),
      }),
      stats: stubNamespace({
        get: () => Promise.resolve({
          ok: true as const,
          data: {
            network: { totalPosts: 10000, totalAgents: 50, totalTransactions: 20000 },
            activity: { postsLast24h: 500, activeAgentsLast24h: 30, reactionsLast24h: 200 },
            quality: { avgScore: 72, attestationRate: 0.85 },
            predictions: { total: 300, accuracy: 0.68 },
            tips: { totalDem: 50000, uniqueTippers: 20 },
            consensus: { activeTopics: 15, avgAgentsPerTopic: 4 },
            content: { categoryBreakdown: {} },
            computedAt: new Date().toISOString(),
          },
        }),
      }),
    });

    const evidence = await extractNetwork(tk);
    expect(evidence.length).toBeGreaterThanOrEqual(1);
    const healthEvidence = evidence.find(e => e.sourceId === "network-health");
    expect(healthEvidence).toBeDefined();
    expect(healthEvidence!.metrics).toContain("status:ok");
    const activityEvidence = evidence.find(e => e.sourceId === "network-activity");
    expect(activityEvidence).toBeDefined();
    expect(activityEvidence!.metrics).toContain("posts24h:500");
  });

  it("returns partial results when only health succeeds", async () => {
    const tk = createMockToolkit({
      health: stubNamespace({
        check: () => Promise.resolve({
          ok: true as const,
          data: { status: "ok" as const, uptime: 86400, timestamp: Date.now() },
        }),
      }),
    });

    const evidence = await extractNetwork(tk);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sourceId).toBe("network-health");
  });

  it("returns [] when both fail", async () => {
    const tk = createMockToolkit();
    expect(await extractNetwork(tk)).toEqual([]);
  });
});

// ── Registry ─────────────────────────────────────────

describe("EXTRACTOR_REGISTRY", () => {
  it("contains all 10 extractors", () => {
    const expected = [
      "colony-feeds", "colony-signals", "threads", "engagement",
      "oracle", "leaderboard", "prices", "predictions",
      "verification", "network",
    ];
    expect(Object.keys(EXTRACTOR_REGISTRY).sort()).toEqual(expected.sort());
  });

  it("all values are functions", () => {
    for (const [key, fn] of Object.entries(EXTRACTOR_REGISTRY)) {
      expect(typeof fn).toBe("function");
    }
  });
});

// ── Richness/freshness edge cases ────────────────────

describe("richness calculation", () => {
  it("caps richness at 95", async () => {
    const longText = "x".repeat(10000);
    const tk = createMockToolkit({
      feed: stubNamespace({
        getRecent: () => Promise.resolve({
          ok: true as const,
          data: {
            posts: [{ txHash: "0xlong", author: "0x1", timestamp: Date.now(), payload: { text: longText, cat: "FEED" } }],
            hasMore: false,
          },
        }),
      }),
    });

    const evidence = await extractColonyFeeds(tk);
    expect(evidence[0].richness).toBeLessThanOrEqual(95);
  });

  it("marks old posts as stale", async () => {
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    const tk = createMockToolkit({
      feed: stubNamespace({
        getRecent: () => Promise.resolve({
          ok: true as const,
          data: {
            posts: [{ txHash: "0xold", author: "0x1", timestamp: twoDaysAgo, payload: { text: "Old post content here for testing purposes", cat: "FEED" } }],
            hasMore: false,
          },
        }),
      }),
    });

    const evidence = await extractColonyFeeds(tk);
    expect(evidence[0].stale).toBe(true);
    expect(evidence[0].freshness).toBeGreaterThan(86_400);
  });
});
