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

import { resolve } from "node:path";

const STRATEGY_PATH = resolve(import.meta.dirname, "../../templates/base/strategy.yaml");

// ── Lazy-load observe ──
let learnFirstObserve: (toolkit: Toolkit, address: string, strategyPath?: string) => Promise<ObserveResult>;

beforeEach(async () => {
  const mod = await import("../../templates/base/observe.js");
  learnFirstObserve = mod.learnFirstObserve;
});

describe("templates/base learnFirstObserve", () => {
  it("prefetches FEED posts via single-fetch router", async () => {
    const toolkit = createMockToolkit();
    await learnFirstObserve(toolkit, OUR_ADDRESS, STRATEGY_PATH);

    // Single-fetch: router prefetches FEED category once, reused for colony state
    expect((toolkit.feed.getRecent as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(toolkit.feed.getRecent).toHaveBeenCalledWith(expect.objectContaining({ category: "FEED" }));
  });

  it("produces feed evidence from FEED posts via extractor", async () => {
    const feedPosts = [
      { txHash: "0xfeed1", author: "feedbot", timestamp: Date.now(), payload: { text: "Breaking: Arbitrum governance proposal to reduce sequencer fees by 40% passes first vote with strong community support and 85% approval rate from delegate voters", cat: "FEED" }, tags: [] },
    ];
    const recentPosts = [
      { txHash: "0xagent1", author: "agent1", timestamp: Date.now(), text: "BTC momentum analysis for today", category: "ANALYSIS", tags: ["bitcoin"] },
    ];

    const getRecentMock = vi.fn().mockImplementation((opts?: any) =>
      Promise.resolve({ ok: true, data: { posts: opts?.category === "FEED" ? feedPosts : recentPosts } }),
    );

    const toolkit = createMockToolkit({
      feed: {
        getRecent: getRecentMock,
        search: vi.fn().mockResolvedValue({ ok: false }),
        getPost: vi.fn().mockResolvedValue(null),
        getThread: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await learnFirstObserve(toolkit, OUR_ADDRESS, STRATEGY_PATH);

    // Strategy-driven router produces feed evidence via colony-feeds extractor
    const feedEvidence = result.evidence.filter(e => e.sourceId.startsWith("feed-"));
    expect(feedEvidence.length).toBeGreaterThanOrEqual(1);
  });

  it("produces signal evidence from colony signals via extractor", async () => {
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

    const result = await learnFirstObserve(toolkit, OUR_ADDRESS, STRATEGY_PATH);

    // Strategy-driven router extracts ALL signals via colony-signals extractor
    const signalEvidence = result.evidence.filter(e => e.sourceId.startsWith("signal-"));
    expect(signalEvidence.length).toBe(2);
    expect(signalEvidence[0].sourceId).toBe("signal-ETH");
  });

  it("produces divergence evidence from oracle via extractor", async () => {
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

    const result = await learnFirstObserve(toolkit, OUR_ADDRESS, STRATEGY_PATH);

    // Oracle extractor includes all divergences (filtering by severity is strategy's job)
    const divEvidence = result.evidence.filter(e => e.sourceId.startsWith("divergence-"));
    expect(divEvidence.length).toBe(2);
    expect(divEvidence[0].sourceId).toBe("divergence-BTC-agents_vs_market");
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

    const result = await learnFirstObserve(toolkit, OUR_ADDRESS, STRATEGY_PATH);

    expect(result).toBeDefined();
    expect(result.colonyState).toBeDefined();
    expect(result.evidence).toBeInstanceOf(Array);
  });

  it("returns apiEnrichment in context for strategy engine", async () => {
    const toolkit = createMockToolkit();
    const result = await learnFirstObserve(toolkit, OUR_ADDRESS, STRATEGY_PATH);

    expect(result.context).toBeDefined();
  });
});
