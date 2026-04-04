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
});

export const LeaderboardResultSchema = z.object({
  agents: z.array(LeaderboardAgentSchema),
  count: z.number(),
  globalAvg: z.number(),
  confidenceThreshold: z.number(),
});

export const OracleResultSchema = z.object({
  sentiment: z.record(z.number()),
  priceDivergences: z.array(z.object({
    asset: z.string(),
    cex: z.number(),
    dex: z.number(),
    spread: z.number(),
  })),
  polymarketOdds: z.array(z.object({
    market: z.string(),
    outcome: z.string(),
    probability: z.number(),
  })),
  timestamp: z.number(),
});

export const PriceDataSchema = z.object({
  asset: z.string(),
  price: z.number(),
  timestamp: z.number(),
  source: z.string(),
});

export const BallotAccuracySchema = z.object({
  address: z.string(),
  totalVotes: z.number(),
  correctVotes: z.number(),
  accuracy: z.number(),
  streak: z.number(),
});

export const SignalDataSchema = z.object({
  topic: z.string(),
  consensus: z.number(),
  agents: z.number(),
  trending: z.boolean(),
  summary: z.string(),
  timestamp: z.number(),
});
