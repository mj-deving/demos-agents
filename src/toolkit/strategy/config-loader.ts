import { z } from "zod";
import { parse as parseYaml } from "yaml";

import type { StrategyConfig } from "./types.js";

const DEFAULT_RATE_LIMITS: StrategyConfig["rateLimits"] = {
  postsPerDay: 14,
  postsPerHour: 5,
  reactionsPerSession: 8,
  maxTipAmount: 10,
};

const DEFAULT_PERFORMANCE: StrategyConfig["performance"] = {
  engagement: 40,
  discussion: 25,
  replyBase: 10,
  replyDeep: 10,
  threadDepth: 5,
  economic: 20,
  tipBase: 10,
  tipCap: 10,
  tipMultiplier: 2,
  controversy: 5,
  ageHalfLife: 48,
};

const StrategyRuleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["ENGAGE", "REPLY", "PUBLISH", "TIP"]),
  priority: z.number(),
  conditions: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

const StrategyConfigSchema = z.object({
  apiVersion: z.string().optional(),
  rules: z.array(StrategyRuleSchema).min(1),
  rateLimits: z.object({
    postsPerDay: z.number().int().positive().optional(),
    postsPerHour: z.number().int().positive().optional(),
    reactionsPerSession: z.number().int().positive().optional(),
    maxTipAmount: z.number().positive().optional(),
  }).default({}),
  performance: z.object({
    engagement: z.number().nonnegative().optional(),
    discussion: z.number().nonnegative().optional(),
    replyBase: z.number().nonnegative().optional(),
    replyDeep: z.number().nonnegative().optional(),
    threadDepth: z.number().nonnegative().optional(),
    economic: z.number().nonnegative().optional(),
    tipBase: z.number().nonnegative().optional(),
    tipCap: z.number().nonnegative().optional(),
    tipMultiplier: z.number().nonnegative().optional(),
    controversy: z.number().nonnegative().optional(),
    ageHalfLife: z.number().positive().optional(),
  }).default({}),
  topicWeights: z.record(z.string(), z.number()).default({}),
  enrichment: z.object({
    divergenceThreshold: z.number().nonnegative().optional(),
    minBallotAccuracy: z.number().min(0).max(1).optional(),
    minSignalAgents: z.number().int().nonnegative().optional(),
    minConfidence: z.number().int().min(0).max(100).optional(),
  }).default({}),
  briefingBoost: z.number().int().nonnegative().default(10).optional(),
  leaderboardAdjustment: z.object({
    enabled: z.boolean().default(false),
    topBoostEngagement: z.number().min(-50).max(50).default(15),
    topAdjustPublish: z.number().min(-50).max(50).default(-5),
    bottomBoostPublish: z.number().min(-50).max(50).default(15),
    bottomAdjustEngagement: z.number().min(-50).max(50).default(-5),
  }).optional(),
});

export function loadStrategyConfig(yamlContent: string): StrategyConfig {
  let parsed: unknown;

  try {
    parsed = parseYaml(yamlContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML: ${message}`);
  }

  const result = StrategyConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid strategy config: ${result.error.message}`);
  }

  const config = result.data;

  return {
    rules: config.rules,
    rateLimits: {
      postsPerDay: Math.min(config.rateLimits.postsPerDay ?? DEFAULT_RATE_LIMITS.postsPerDay, 14),
      postsPerHour: Math.min(config.rateLimits.postsPerHour ?? DEFAULT_RATE_LIMITS.postsPerHour, 5),
      reactionsPerSession: config.rateLimits.reactionsPerSession ?? DEFAULT_RATE_LIMITS.reactionsPerSession,
      maxTipAmount: Math.min(config.rateLimits.maxTipAmount ?? DEFAULT_RATE_LIMITS.maxTipAmount, 10),
    },
    performance: {
      engagement: config.performance.engagement ?? DEFAULT_PERFORMANCE.engagement,
      discussion: config.performance.discussion ?? DEFAULT_PERFORMANCE.discussion,
      replyBase: config.performance.replyBase ?? DEFAULT_PERFORMANCE.replyBase,
      replyDeep: config.performance.replyDeep ?? DEFAULT_PERFORMANCE.replyDeep,
      threadDepth: config.performance.threadDepth ?? DEFAULT_PERFORMANCE.threadDepth,
      economic: config.performance.economic ?? DEFAULT_PERFORMANCE.economic,
      tipBase: config.performance.tipBase ?? DEFAULT_PERFORMANCE.tipBase,
      tipCap: config.performance.tipCap ?? DEFAULT_PERFORMANCE.tipCap,
      tipMultiplier: config.performance.tipMultiplier ?? DEFAULT_PERFORMANCE.tipMultiplier,
      controversy: config.performance.controversy ?? DEFAULT_PERFORMANCE.controversy,
      ageHalfLife: config.performance.ageHalfLife ?? DEFAULT_PERFORMANCE.ageHalfLife,
    },
    topicWeights: config.topicWeights,
    enrichment: {
      divergenceThreshold: config.enrichment.divergenceThreshold ?? 10,
      minBallotAccuracy: config.enrichment.minBallotAccuracy ?? 0.5,
      minSignalAgents: config.enrichment.minSignalAgents ?? 2,
      minConfidence: config.enrichment.minConfidence ?? 40,
    },
    briefingBoost: config.briefingBoost ?? 10,
    leaderboardAdjustment: config.leaderboardAdjustment ? {
      enabled: config.leaderboardAdjustment.enabled,
      topBoostEngagement: config.leaderboardAdjustment.topBoostEngagement,
      topAdjustPublish: config.leaderboardAdjustment.topAdjustPublish,
      bottomBoostPublish: config.leaderboardAdjustment.bottomBoostPublish,
      bottomAdjustEngagement: config.leaderboardAdjustment.bottomAdjustEngagement,
    } : undefined,
  };
}
