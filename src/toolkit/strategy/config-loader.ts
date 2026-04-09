import { z } from "zod";
import { parse as parseYaml } from "yaml";

import type { StrategyConfig, LoopLimitsConfig } from "./types.js";

const DEFAULT_LIMITS: LoopLimitsConfig = {
  recentPostsFetchLimit: 500,
  proofIngestionConcurrency: 5,
  proofIngestionLimit: 20,
  sourcesPerIntent: 5,
  sourceFetchConcurrency: 3,
  sourceFetchBudgetMs: 15_000,
  sseTimeoutMs: 5_000,
  sseMaxEvents: 100,
  leaderboardLimit: 20,
  subprocessTimeoutMs: 180_000,
  maxPublishPerSession: 2,
  phaseBudgets: {
    senseMs: 120_000,
    actMs: 120_000,
    confirmMs: 60_000,
  },
};

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
  type: z.enum(["ENGAGE", "REPLY", "PUBLISH", "TIP", "VOTE", "BET"]),
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
    betsPerDay: z.number().int().nonnegative().optional(),
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
    minSignalAgents: z.number().int().nonnegative().optional(),
    minConfidence: z.number().int().min(0).max(100).optional(),
  }).default({}),
  limits: z.object({
    recentPostsFetchLimit: z.number().int().positive().optional(),
    proofIngestionConcurrency: z.number().int().positive().optional(),
    proofIngestionLimit: z.number().int().positive().optional(),
    sourcesPerIntent: z.number().int().positive().optional(),
    sourceFetchConcurrency: z.number().int().positive().optional(),
    sourceFetchBudgetMs: z.number().int().positive().optional(),
    sseTimeoutMs: z.number().int().positive().optional(),
    sseMaxEvents: z.number().int().positive().optional(),
    leaderboardLimit: z.number().int().positive().optional(),
    subprocessTimeoutMs: z.number().int().positive().optional(),
    maxPublishPerSession: z.number().int().positive().optional(),
    phaseBudgets: z.object({
      senseMs: z.number().int().positive().optional(),
      actMs: z.number().int().positive().optional(),
      confirmMs: z.number().int().positive().optional(),
    }).default({}),
  }).default({}),
  evidence: z.object({
    categories: z.object({
      core: z.array(z.string()).optional(),
      domain: z.array(z.string()).optional(),
      meta: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
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
      betsPerDay: Math.min(config.rateLimits.betsPerDay ?? 3, 5),
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
      minSignalAgents: config.enrichment.minSignalAgents ?? 5,
      minConfidence: config.enrichment.minConfidence ?? 70,
    },
    limits: {
      recentPostsFetchLimit: config.limits.recentPostsFetchLimit ?? DEFAULT_LIMITS.recentPostsFetchLimit,
      proofIngestionConcurrency: config.limits.proofIngestionConcurrency ?? DEFAULT_LIMITS.proofIngestionConcurrency,
      proofIngestionLimit: config.limits.proofIngestionLimit ?? DEFAULT_LIMITS.proofIngestionLimit,
      sourcesPerIntent: config.limits.sourcesPerIntent ?? DEFAULT_LIMITS.sourcesPerIntent,
      sourceFetchConcurrency: config.limits.sourceFetchConcurrency ?? DEFAULT_LIMITS.sourceFetchConcurrency,
      sourceFetchBudgetMs: config.limits.sourceFetchBudgetMs ?? DEFAULT_LIMITS.sourceFetchBudgetMs,
      sseTimeoutMs: config.limits.sseTimeoutMs ?? DEFAULT_LIMITS.sseTimeoutMs,
      sseMaxEvents: config.limits.sseMaxEvents ?? DEFAULT_LIMITS.sseMaxEvents,
      leaderboardLimit: config.limits.leaderboardLimit ?? DEFAULT_LIMITS.leaderboardLimit,
      subprocessTimeoutMs: config.limits.subprocessTimeoutMs ?? DEFAULT_LIMITS.subprocessTimeoutMs,
      maxPublishPerSession: config.limits.maxPublishPerSession ?? DEFAULT_LIMITS.maxPublishPerSession,
      phaseBudgets: {
        senseMs: config.limits.phaseBudgets.senseMs ?? DEFAULT_LIMITS.phaseBudgets.senseMs,
        actMs: config.limits.phaseBudgets.actMs ?? DEFAULT_LIMITS.phaseBudgets.actMs,
        confirmMs: config.limits.phaseBudgets.confirmMs ?? DEFAULT_LIMITS.phaseBudgets.confirmMs,
      },
    },
    evidence: config.evidence ? {
      categories: config.evidence.categories ? {
        core: config.evidence.categories.core,
        domain: config.evidence.categories.domain,
        meta: config.evidence.categories.meta,
      } : undefined,
    } : undefined,
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
