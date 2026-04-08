import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { computeAvailableEvidence } from "../../src/toolkit/colony/available-evidence.js";
import { initColonyCache } from "../../src/toolkit/colony/schema.js";
import { upsertSourceResponse } from "../../src/toolkit/colony/source-cache.js";
import { loadStrategyConfig } from "../../src/toolkit/strategy/config-loader.js";
import { buildEvidenceIndex } from "../../src/toolkit/strategy/engine-helpers.js";
import { decideActions } from "../../src/toolkit/strategy/engine.js";
import type { ColonyState } from "../../src/toolkit/colony/state-extraction.js";
import type { DecisionContext } from "../../src/toolkit/strategy/types.js";
import { makeBettingPool, makePriceData, makeSignalData } from "../primitives/_helpers.js";

describe("publish path e2e", () => {
  it("produces publish actions when cache evidence, enrichment, and colony gaps are wired together", () => {
    const db = initColonyCache(":memory:");

    try {
      const now = new Date("2026-04-01T12:00:00.000Z");
      const gapTopic = "Bitcoin ETF custody demand";
      const gapLastPostAt = "2026-03-31T08:00:00.000Z";

      upsertSourceResponse(db, {
        sourceId: "btc-etf-desk",
        url: "https://example.com/research/btc-etf",
        lastFetchedAt: "2026-04-01T11:56:00.000Z",
        responseStatus: 200,
        responseSize: 800,
        responseBody: "{\"desk\":\"etf flows\"}",
        ttlSeconds: 900,
        consecutiveFailures: 0,
      });
      upsertSourceResponse(db, {
        sourceId: "btc-liquidity-desk",
        url: "https://example.com/research/btc-liquidity",
        lastFetchedAt: "2026-04-01T11:58:00.000Z",
        responseStatus: 200,
        responseSize: 800,
        responseBody: "{\"desk\":\"liquidity rotation\"}",
        ttlSeconds: 900,
        consecutiveFailures: 0,
      });
      upsertSourceResponse(db, {
        sourceId: "eth-derivatives-desk",
        url: "https://example.com/research/eth-derivatives",
        lastFetchedAt: "2026-04-01T11:57:00.000Z",
        responseStatus: 200,
        responseSize: 800,
        responseBody: "{\"desk\":\"eth basis\"}",
        ttlSeconds: 900,
        consecutiveFailures: 0,
      });

      const availableEvidence = computeAvailableEvidence(db, [
        {
          id: "btc-etf-desk",
          topics: ["Bitcoin ETF institutional flows"],
          domainTags: ["bitcoin", "etf", "custody", "demand"],
        },
        {
          id: "btc-liquidity-desk",
          topics: ["Bitcoin macro liquidity rotation"],
          domainTags: ["bitcoin", "liquidity", "capital flows"],
        },
        {
          id: "eth-derivatives-desk",
          topics: ["Ethereum derivatives basis"],
          domainTags: ["eth", "basis", "open interest"],
        },
      ], now);

      const evidenceIndex = buildEvidenceIndex(availableEvidence);

      expect(availableEvidence.length).toBeGreaterThanOrEqual(9);
      expect(evidenceIndex.get("bitcoin")?.map((item) => item.sourceId)).toEqual(
        expect.arrayContaining(["btc-etf-desk", "btc-liquidity-desk"]),
      );
      expect(evidenceIndex.get("eth")?.map((item) => item.sourceId)).toEqual(
        expect.arrayContaining(["eth-derivatives-desk"]),
      );

      const colonyState: ColonyState = {
        activity: {
          postsPerHour: 2,
          activeAuthors: 3,
          trendingTopics: [
            { topic: "bitcoin", count: 3 },
            { topic: "eth", count: 2 },
          ],
        },
        gaps: {
          underservedTopics: [
            { topic: gapTopic, lastPostAt: gapLastPostAt },
          ],
          unansweredQuestions: [],
          staleThreads: [],
        },
        threads: {
          activeDiscussions: [],
          mentionsOfUs: [],
        },
        agents: {
          topContributors: [
            { author: "alice", postCount: 5, avgReactions: 8 },
            { author: "bob", postCount: 4, avgReactions: 6 },
          ],
        },
      };

      const config = loadStrategyConfig(
        readFileSync(resolve(process.cwd(), "agents/sentinel/strategy.yaml"), "utf-8"),
      );

      const context: DecisionContext = {
        ourAddress: "demos1sentinel",
        sessionReactionsUsed: 0,
        postsToday: 0,
        postsThisHour: 0,
        now,
        maxPublishPerSession: config.limits?.maxPublishPerSession,
        apiEnrichment: {
          signals: [
            makeSignalData({
              topic: "Bitcoin ETF demand",
              agentCount: 4,
              totalAgents: 12,
              confidence: 78,
              text: "Desk consensus expects ETF-led BTC demand",
              trending: true,
            }),
            makeSignalData({
              topic: "ETH basis expansion",
              direction: "neutral",
              agentCount: 3,
              totalAgents: 12,
              confidence: 64,
              text: "Derivatives desks see basis normalization",
              trending: true,
            }),
          ],
          oracle: {
            divergences: [
              {
                type: "agents_vs_market",
                asset: "BTC",
                description: "Agents bullish while spot desks fade the move",
                severity: "high",
                details: {
                  agentDirection: "bullish",
                  marketDirection: "neutral",
                  agentConfidence: 82,
                },
              },
            ],
          },
          prices: [
            makePriceData({ ticker: "BTC", priceUsd: 68_250, fetchedAt: now.getTime() - 60_000 }),
            makePriceData({ ticker: "ETH", priceUsd: 3_420, fetchedAt: now.getTime() - 60_000 }),
          ],
          bettingPool: makeBettingPool({
            asset: "BTC",
            totalBets: 4,
            totalDem: 19,
            roundEnd: now.getTime() + 60 * 60 * 1000,
            bets: [
              {
                txHash: "0xpool-1",
                bettor: "0xagent-a",
                predictedPrice: 69_000,
                amount: 5,
                roundEnd: now.getTime() + 60 * 60 * 1000,
                horizon: "1h",
              },
              {
                txHash: "0xpool-2",
                bettor: "0xagent-b",
                predictedPrice: 68_800,
                amount: 4,
                roundEnd: now.getTime() + 60 * 60 * 1000,
                horizon: "1h",
              },
            ],
          }),
        },
      };

      const result = decideActions(colonyState, availableEvidence, config, context);
      const publishActions = result.actions.filter((action) => action.type === "PUBLISH");

      expect(publishActions.length).toBeGreaterThan(0);

      const gapAction = publishActions.find((action) => action.target === gapTopic);
      expect(gapAction).toBeDefined();
      expect(gapAction).toMatchObject({
        type: "PUBLISH",
        priority: 50,
        target: gapTopic,
        metadata: {
          lastPostAt: gapLastPostAt,
        },
      });
      expect(new Set(gapAction?.evidence ?? [])).toEqual(new Set(["btc-etf-desk", "btc-liquidity-desk"]));

      expect(publishActions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          target: "Bitcoin ETF demand",
          type: "PUBLISH",
          priority: 60,
          metadata: expect.objectContaining({
            signalAgents: 4,
            signalConsensus: true,
          }),
        }),
        expect.objectContaining({
          target: "btc",
          type: "PUBLISH",
          priority: 70,
          metadata: expect.objectContaining({
            asset: "BTC",
            severity: "high",
            type: "agents_vs_market",
          }),
        }),
        expect.objectContaining({
          type: "PUBLISH",
          priority: 45,
          metadata: expect.objectContaining({
            poolAsset: "BTC",
            totalBets: 4,
            availableAssets: ["BTC", "ETH"],
          }),
        }),
      ]));
    } finally {
      db.close();
    }
  });
});
