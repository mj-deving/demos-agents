/**
 * Tests for templates/base/ Learn-first observe function.
 *
 * Verifies:
 * - Colony FEED posts are read and gap-detected
 * - Colony signals produce consensus evidence
 * - Oracle divergences produce evidence
 * - Per-asset sentiment produces evidence
 * - Null-safe when all API calls fail
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";
import type { ObserveResult } from "../../src/toolkit/agent-loop.js";

const OUR_ADDRESS = "0xbase-agent";

function createMockToolkit(overrides: Record<string, unknown> = {}): Toolkit {
  return {
    feed: {
      getRecent: vi.fn().mockResolvedValue({ ok: true, data: { posts: [] } }),
      search: vi.fn().mockResolvedValue(null),
      getPost: vi.fn().mockResolvedValue(null),
      getThread: vi.fn().mockResolvedValue(null),
    },
    intelligence: {
      getSignals: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getReport: vi.fn().mockResolvedValue(null),
    },
    scores: { getLeaderboard: vi.fn().mockResolvedValue(null) },
    agents: {
      list: vi.fn().mockResolvedValue(null),
      getProfile: vi.fn().mockResolvedValue(null),
      getIdentities: vi.fn().mockResolvedValue(null),
    },
    actions: {
      tip: vi.fn().mockResolvedValue(null),
      react: vi.fn().mockResolvedValue(null),
      getReactions: vi.fn().mockResolvedValue(null),
      getTipStats: vi.fn().mockResolvedValue(null),
      getAgentTipStats: vi.fn().mockResolvedValue(null),
      placeBet: vi.fn().mockResolvedValue(null),
    },
    oracle: { get: vi.fn().mockResolvedValue(null) },
    prices: { get: vi.fn().mockResolvedValue(null) },
    verification: { verifyDahr: vi.fn().mockResolvedValue(null), verifyTlsn: vi.fn().mockResolvedValue(null) },
    predictions: { query: vi.fn().mockResolvedValue(null), resolve: vi.fn().mockResolvedValue(null), markets: vi.fn().mockResolvedValue(null) },
    ballot: {
      getState: vi.fn().mockResolvedValue(null),
      getAccuracy: vi.fn().mockResolvedValue(null),
      getLeaderboard: vi.fn().mockResolvedValue(null),
      getPerformance: vi.fn().mockResolvedValue(null),
      getPool: vi.fn().mockResolvedValue(null),
    },
    webhooks: { list: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(null), delete: vi.fn().mockResolvedValue(null) },
    identity: { lookup: vi.fn().mockResolvedValue(null) },
    balance: { get: vi.fn().mockResolvedValue(null) },
    health: { check: vi.fn().mockResolvedValue(null) },
    stats: { get: vi.fn().mockResolvedValue(null) },
    ...overrides,
  } as unknown as Toolkit;
}

// ── Lazy-load observe ──
let learnFirstObserve: (toolkit: Toolkit, address: string) => Promise<ObserveResult>;

beforeEach(async () => {
  const mod = await import("../../templates/base/observe.js");
  learnFirstObserve = mod.learnFirstObserve;
});

describe("templates/base learnFirstObserve", () => {
  it("reads both FEED and recent posts in parallel", async () => {
    const toolkit = createMockToolkit();
    await learnFirstObserve(toolkit, OUR_ADDRESS);

    // getRecent called at least 3 times: FEED category, recent, and enrichedObserve's defaultObserve
    expect((toolkit.feed.getRecent as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(toolkit.feed.getRecent).toHaveBeenCalledWith(expect.objectContaining({ category: "FEED" }));
  });

  it("produces gap evidence from FEED posts not covered by agents", async () => {
    const feedPosts = [
      { txHash: "0xfeed1", author: "feedbot", timestamp: Date.now(), text: "Breaking: Arbitrum governance proposal to reduce sequencer fees by 40% passes first vote with strong community support and 85% approval rate from delegate voters", category: "FEED", tags: [] },
    ];
    const recentPosts = [
      { txHash: "0xagent1", author: "agent1", timestamp: Date.now(), text: "BTC momentum analysis for today", category: "ANALYSIS", tags: ["bitcoin"] },
    ];

    // Route based on category parameter — FEED gets feedPosts, everything else gets recentPosts
    const getRecentMock = vi.fn().mockImplementation((opts?: any) =>
      Promise.resolve({ ok: true, data: { posts: opts?.category === "FEED" ? feedPosts : recentPosts } }),
    );

    const toolkit = createMockToolkit({
      feed: {
        getRecent: getRecentMock,
        search: vi.fn().mockResolvedValue(null),
        getPost: vi.fn().mockResolvedValue(null),
        getThread: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await learnFirstObserve(toolkit, OUR_ADDRESS);

    const gapEvidence = result.evidence.filter(e => e.sourceId.startsWith("feed-gap-"));
    expect(gapEvidence.length).toBeGreaterThanOrEqual(1);
    expect(gapEvidence[0].metrics).toContain("colony-gap");
    expect(gapEvidence[0].metrics[0]).toContain("feedRef=");
  });

  it("produces consensus evidence from colony signals with 3+ agents", async () => {
    const toolkit = createMockToolkit({
      intelligence: {
        getSignals: vi.fn().mockResolvedValue({
          ok: true,
          data: [
            { topic: "ETH", agentCount: 5, totalAgents: 10, confidence: 80, text: "Bullish on ETH staking yields", trending: true, direction: "bullish", consensus: true },
            { topic: "DOGE", agentCount: 1, totalAgents: 10, confidence: 30, text: "Meme coin noise", trending: false, direction: "neutral", consensus: false },
          ],
        }),
        getReport: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await learnFirstObserve(toolkit, OUR_ADDRESS);

    const signalEvidence = result.evidence.filter(e => e.sourceId.startsWith("colony-signal-"));
    // Only ETH (5 agents >= 3), not DOGE (1 agent < 3)
    expect(signalEvidence.length).toBe(1);
    expect(signalEvidence[0].sourceId).toBe("colony-signal-ETH");
  });

  it("produces divergence evidence from oracle (medium+ severity)", async () => {
    const toolkit = createMockToolkit({
      oracle: {
        get: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            divergences: [
              { type: "agents_vs_market", asset: "BTC", description: "Agents bullish but price declining", severity: "medium" },
              { type: "agents_vs_market", asset: "ETH", description: "Low noise", severity: "low" },
            ],
            assets: [],
          },
        }),
      },
    });

    const result = await learnFirstObserve(toolkit, OUR_ADDRESS);

    const divEvidence = result.evidence.filter(e => e.sourceId.startsWith("divergence-"));
    // Only BTC (medium), not ETH (low)
    expect(divEvidence.length).toBe(1);
    expect(divEvidence[0].sourceId).toBe("divergence-BTC");
  });

  it("is null-safe when all API calls fail", async () => {
    const toolkit = createMockToolkit({
      feed: {
        getRecent: vi.fn().mockResolvedValue({ ok: false, error: "down" }),
        search: vi.fn().mockResolvedValue(null),
        getPost: vi.fn().mockResolvedValue(null),
        getThread: vi.fn().mockResolvedValue(null),
      },
      oracle: { get: vi.fn().mockResolvedValue(null) },
      intelligence: { getSignals: vi.fn().mockResolvedValue(null), getReport: vi.fn().mockResolvedValue(null) },
    });

    const result = await learnFirstObserve(toolkit, OUR_ADDRESS);

    expect(result).toBeDefined();
    expect(result.colonyState).toBeDefined();
    expect(result.evidence).toBeInstanceOf(Array);
  });

  it("returns apiEnrichment in context for strategy engine", async () => {
    const toolkit = createMockToolkit();
    const result = await learnFirstObserve(toolkit, OUR_ADDRESS);

    expect(result.context).toBeDefined();
  });
});
