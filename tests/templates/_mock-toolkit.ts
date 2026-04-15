/**
 * Shared mock toolkit factory for template tests.
 * Avoids duplicating 60+ lines of mock wiring in each template test file.
 */
import { vi } from "vitest";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";

export interface MockToolkitOverrides {
  feedSearchResult?: unknown;
  feedRecentResult?: unknown;
  signalsResult?: unknown;
}

/**
 * Create a mock toolkit for template tests.
 * Supports two override styles:
 * 1. MockToolkitOverrides — typed fields for common overrides
 * 2. Record<string, unknown> — arbitrary domain-level overrides (spread on top)
 */
export function createMockToolkit(overrides?: MockToolkitOverrides | Record<string, unknown>): Toolkit {
  // Detect typed vs arbitrary overrides
  const typed = overrides as MockToolkitOverrides | undefined;
  const isTyped = typed && ("feedSearchResult" in typed || "feedRecentResult" in typed || "signalsResult" in typed);

  const base: Toolkit = {
    feed: {
      getRecent: vi.fn().mockResolvedValue(isTyped && typed?.feedRecentResult ? typed.feedRecentResult : { ok: true, data: { posts: [] } }),
      search: vi.fn().mockResolvedValue(isTyped && typed?.feedSearchResult ? typed.feedSearchResult : { ok: true, data: { posts: [] } }),
      getPost: vi.fn().mockResolvedValue(null),
      getThread: vi.fn().mockResolvedValue(null),
    },
    intelligence: {
      getSignals: vi.fn().mockResolvedValue(isTyped && typed?.signalsResult ? typed.signalsResult : { ok: true, data: [] }),
      getConvergence: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      getReport: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    },
    scores: {
      getLeaderboard: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      getTopPosts: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    },
    agents: {
      list: vi.fn().mockResolvedValue({ ok: true, data: { agents: [] } }),
      getProfile: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      getIdentities: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    },
    actions: {
      tip: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      react: vi.fn().mockResolvedValue({ ok: true }),
      getReactions: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      getTipStats: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      getAgentTipStats: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      placeBet: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    },
    oracle: { get: vi.fn().mockResolvedValue({ ok: true, data: {} }) },
    prices: {
      get: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getHistory: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    },
    verification: {
      verifyDahr: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      verifyTlsn: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    },
    predictions: {
      query: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      resolve: vi.fn().mockResolvedValue({ ok: true }),
      markets: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    },
    ballot: {
      getPool: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      getHigherLowerPool: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      getBinaryPools: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    },
    webhooks: {
      list: vi.fn().mockResolvedValue({ ok: true, data: { webhooks: [] } }),
      create: vi.fn().mockResolvedValue({ ok: true }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
    },
    identity: { lookup: vi.fn().mockResolvedValue({ ok: true, data: {} }) },
    balance: { get: vi.fn().mockResolvedValue({ ok: true, data: {} }) },
    health: { check: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok", uptime: 99.9, timestamp: Date.now() } }) },
    stats: { get: vi.fn().mockResolvedValue({ ok: true, data: { activity: { postsLast24h: 100, activeAgents24h: 10 }, network: { totalAgents: 50, totalPosts: 5000 }, quality: { attestationRate: 58.84 }, predictions: { total: 100, accuracy: 38.12 }, tips: { totalDem: 0, uniqueTippers: 0 }, consensus: {}, content: {}, computedAt: Date.now() } }) },
  };

  // Apply arbitrary domain-level overrides (e.g., { intelligence: {...} })
  if (overrides && !isTyped) {
    return { ...base, ...overrides } as unknown as Toolkit;
  }

  return base;
}
