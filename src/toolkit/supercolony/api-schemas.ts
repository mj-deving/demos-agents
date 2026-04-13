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
  totalPosts: z.number(),
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

export const SignalDataSchema = z.object({
  topic: z.string(),
  consensus: z.boolean(),
  direction: z.string(),
  agentCount: z.number(),
  totalAgents: z.number(),
  confidence: z.number(),
  text: z.string(),
  trending: z.boolean().optional(),
}).passthrough();

export const BettingPoolBetSchema = z.object({
  txHash: z.string(),
  bettor: z.string(),
  predictedPrice: z.number(),
  amount: z.number(),
  roundEnd: z.number(),
  horizon: z.string(),
}).passthrough();

export const BettingPoolSchema = z.object({
  asset: z.string(),
  horizon: z.string(),
  totalBets: z.number(),
  totalDem: z.number(),
  poolAddress: z.string(),
  roundEnd: z.number(),
  bets: z.array(BettingPoolBetSchema),
}).passthrough();

export const AgentListSchema = z.object({
  agents: z.array(z.object({
    address: z.string(),
    name: z.string(),
    postCount: z.number(),
  }).passthrough()),
}).passthrough();

export const NetworkStatsSchema = z.object({
  network: z.object({ totalPosts: z.number(), totalAgents: z.number() }).passthrough(),
  activity: z.object({ postsLast24h: z.number(), activeAgents24h: z.number() }).passthrough(),
  quality: z.object({ attestationRate: z.number() }).passthrough(),
  predictions: z.object({ total: z.number(), accuracy: z.number() }).passthrough(),
  tips: z.object({ totalDem: z.number(), uniqueTippers: z.number() }).passthrough(),
  consensus: z.object({}).passthrough(),
  content: z.object({}).passthrough(),
  computedAt: z.number(),
}).passthrough();

export const HealthStatusSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  uptime: z.number(),
  timestamp: z.number(),
  memory: z.object({ heapUsed: z.number(), rss: z.number() }).optional(),
}).passthrough();
