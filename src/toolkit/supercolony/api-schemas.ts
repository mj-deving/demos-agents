/**
 * Zod schemas for critical SuperColony API responses.
 *
 * Used to validate enrichment data at the consumption boundary (v3-loop)
 * rather than at the generic api-client level. This ensures that malformed
 * API responses are caught before entering the strategy engine.
 */

import { z } from "zod";

export const LeaderboardAgentSchema = z.object({
  address: z.string(),
  name: z.string(),
  postCount: z.number(),
  avgScore: z.number(),
  bayesianScore: z.number(),
  topScore: z.number(),
  lowScore: z.number(),
  lastActiveAt: z.number(),
}).passthrough();

export const LeaderboardResultSchema = z.object({
  agents: z.array(LeaderboardAgentSchema),
  count: z.number(),
  globalAvg: z.number(),
  confidenceThreshold: z.number(),
});

export const OracleResultSchema = z.object({
  overallSentiment: z.object({
    direction: z.string(),
    score: z.number(),
    agentCount: z.number(),
    topAssets: z.array(z.string()),
  }).optional(),
  assets: z.array(z.object({
    ticker: z.string(),
    postCount: z.number(),
    price: z.object({
      usd: z.number(),
      change24h: z.number(),
      high24h: z.number(),
      low24h: z.number(),
    }).passthrough(),
  }).passthrough()).optional(),
  divergences: z.array(z.object({
    type: z.string(),
    asset: z.string(),
    description: z.string(),
    severity: z.enum(["low", "medium", "high"]),
    details: z.record(z.unknown()).optional(),
  })).default([]),
  polymarket: z.record(z.unknown()).optional(),
  meta: z.record(z.unknown()).optional(),
}).passthrough();

export const PriceDataSchema = z.object({
  ticker: z.string(),
  priceUsd: z.number(),
  fetchedAt: z.number(),
  source: z.string(),
}).passthrough();

export const BallotAccuracySchema = z.object({
  address: z.string(),
  totalVotes: z.number(),
  correctVotes: z.number(),
  accuracy: z.number(),
  streak: z.number(),
});

export const SignalDataSchema = z.object({
  topic: z.string(),
  consensus: z.boolean(),
  direction: z.string(),
  agentCount: z.number(),
  totalAgents: z.number(),
  confidence: z.number(),
  text: z.string(),
  trending: z.boolean(),
}).passthrough();

export const NetworkStatsSchema = z.object({
  network: z.object({ totalPosts: z.number(), totalAgents: z.number(), totalTransactions: z.number() }),
  activity: z.object({ postsLast24h: z.number(), activeAgentsLast24h: z.number(), reactionsLast24h: z.number() }),
  quality: z.object({ avgScore: z.number(), attestationRate: z.number() }),
  predictions: z.object({ total: z.number(), accuracy: z.number() }),
  tips: z.object({ totalDem: z.number(), uniqueTippers: z.number() }),
  consensus: z.object({ activeTopics: z.number(), avgAgentsPerTopic: z.number() }),
  content: z.object({ categoryBreakdown: z.record(z.number()) }),
  computedAt: z.string(),
}).passthrough();

export const HealthStatusSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  uptime: z.number(),
  timestamp: z.number(),
  memory: z.object({ heapUsed: z.number(), rss: z.number() }).optional(),
}).passthrough();
