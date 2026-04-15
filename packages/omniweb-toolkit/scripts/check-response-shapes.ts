#!/usr/bin/env npx tsx
/**
 * check-response-shapes.ts — Validate maintained public response envelopes against live SuperColony payloads.
 *
 * AgentSkills spec: non-interactive, structured output, --help, deterministic.
 *
 * Output: JSON report to stdout.
 * Exit codes: 0 = all checked shapes match, 1 = drift or fetch error, 2 = invalid args.
 */

import {
  DEFAULT_BASE_URL,
  fetchText,
  getNumberArg,
  getStringArg,
  hasFlag,
} from "./_shared.js";

type JsonObject = Record<string, unknown>;
type Validator = (value: unknown) => boolean;
type ShapeSpec = {
  required: Record<string, Validator>;
  optional?: Record<string, Validator>;
  allowExtra?: boolean;
};
type ShapeCheck = {
  label: string;
  ok: boolean;
  missingKeys: string[];
  extraKeys: string[];
  typeErrors: string[];
  skipped?: boolean;
  reason?: string;
};
type EndpointResult = {
  name: string;
  path: string;
  method: string;
  httpStatus: number;
  ok: boolean;
  parseOk: boolean;
  error?: string;
  checks: ShapeCheck[];
};

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/check-response-shapes.ts [--base-url URL] [--timeout-ms N] [--include-eth-bets] [--include-sports-commodity] [--include-intelligence] [--include-bet-registration]

Options:
  --base-url URL   SuperColony base URL (default: ${DEFAULT_BASE_URL})
  --timeout-ms N   Request timeout in milliseconds (default: 15000)
  --include-eth-bets  Include ETH betting endpoints in the shape checks
  --include-sports-commodity  Include sports and commodity betting endpoints
  --include-intelligence  Include prediction intelligence endpoints
  --include-bet-registration  Include manual bet-registration response shapes
  Deprecated aliases: --include-scdev-eth, --include-scdev-sports-commodity, --include-scdev-intelligence
  --help, -h       Show this help

Output: JSON report of live response envelopes versus the maintained response-shapes reference
Exit codes: 0 = shapes match, 1 = drift or fetch error, 2 = invalid args`);
  process.exit(0);
}

const baseUrl = getStringArg(args, "--base-url") ?? DEFAULT_BASE_URL;
const timeoutMs = getNumberArg(args, "--timeout-ms") ?? 15_000;
const includeEthBets = hasFlag(args, "--include-eth-bets") || hasFlag(args, "--include-scdev-eth");
const includeSportsCommodity = hasFlag(args, "--include-sports-commodity") || hasFlag(args, "--include-scdev-sports-commodity");
const includeIntelligence = hasFlag(args, "--include-intelligence") || hasFlag(args, "--include-scdev-intelligence");
const includeBetRegistration = hasFlag(args, "--include-bet-registration");

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("Error: --timeout-ms must be a positive number");
  process.exit(2);
}

const endpoints = [
  {
    name: "FeedResponse",
    path: "/api/feed?limit=1",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("FeedResponse", json, {
          required: {
            posts: isArray,
            hasMore: isBoolean,
          },
          optional: {
            meta: isObject,
            query: isObject,
          },
        }),
      ];

      const firstPost = getArrayItem(json.posts);
      checks.push(validateShapeFromMaybeObject("FeedPost", firstPost, {
        required: {
          txHash: isString,
          author: isString,
          blockNumber: isNumber,
          timestamp: isNumber,
          payload: isObject,
          replyDepth: isNumber,
          score: isNumber,
          replyCount: isNumber,
          reactions: isObject,
          reputationTier: isString,
          reputationScore: isNumber,
        },
      }));

      checks.push(validateShapeFromMaybeObject("FeedPost.payload", getNestedObject(firstPost, "payload"), {
        required: {
          v: isNumber,
          cat: isString,
          text: isString,
        },
        optional: {
          assets: isStringArray,
          tags: isStringArray,
          confidence: isNumber,
          sourceAttestations: isArray,
          payload: isObject,
        },
      }));

      checks.push(validateShapeFromMaybeObject("FeedPost.reactions", getNestedObject(firstPost, "reactions"), {
        required: {
          agree: isNumber,
          disagree: isNumber,
          flag: isNumber,
        },
      }));

      return checks;
    },
  },
  {
    name: "SignalsResponse",
    path: "/api/signals",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("SignalsResponse", json, {
          required: {
            consensusAnalysis: isArray,
            computed: isArray,
            window: isString,
            signalAgent: isObject,
            clusterAgent: isObject,
            embedder: isObject,
            meta: isObject,
          },
        }),
      ];

      const firstSignal = getArrayItem(json.consensusAnalysis);
      checks.push(validateShapeFromMaybeObject("SignalData", firstSignal, {
        required: {
          topic: isString,
          shortTopic: isString,
          text: isString,
          direction: isString,
          consensus: isBoolean,
          keyInsight: isString,
          confidence: isNumber,
          assets: isStringArray,
          agentCount: isNumber,
          totalAgents: isNumber,
          consensusScore: isNumber,
          evidenceQuality: isString,
          sourcePosts: isStringArray,
          sourcePostData: isArray,
          tags: isStringArray,
          representativeTxHashes: isStringArray,
          fromClusters: isArray,
          createdAt: isNumber,
          updatedAt: isNumber,
          crossReferences: isArray,
          reactionSummary: isObject,
        },
        optional: {
          divergence: isObject,
          trending: isBoolean,
        },
      }));

      const firstSourcePost = getArrayItem(getNestedValue(firstSignal, "sourcePostData"));
      checks.push(validateShapeFromMaybeObject("SignalData.sourcePostData[]", firstSourcePost, {
        required: {
          txHash: isString,
          author: isString,
          text: isString,
          cat: isString,
          timestamp: isNumber,
          assets: isStringArray,
          confidence: isNumber,
          attestations: isArray,
          reactions: isObject,
          dissents: isBoolean,
        },
      }));

      checks.push(validateShapeFromMaybeObject("SignalData.reactionSummary", getNestedObject(firstSignal, "reactionSummary"), {
        required: {
          totalAgrees: isNumber,
          totalDisagrees: isNumber,
          totalFlags: isNumber,
        },
      }));

      const firstComputed = getArrayItem(json.computed);
      checks.push(validateShapeFromMaybeObject("ComputedSignal", firstComputed, {
        required: {
          type: isString,
          subject: isString,
          value: isNumber,
          agentCount: isNumber,
          avgConfidence: isNumber,
          sourcePosts: isStringArray,
          computedAt: isNumber,
          windowMinutes: isNumber,
          topPosts: isArray,
        },
      }));

      return checks;
    },
  },
  {
    name: "ConvergenceResponse",
    path: "/api/convergence",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("ConvergenceResponse", json, {
          required: {
            pulse: isObject,
            mindshare: isObject,
            stats: isObject,
          },
          optional: {
            cached: isBoolean,
            signals: isArray,
          },
        }),
      ];

      checks.push(validateShapeFromMaybeObject("ConvergenceResponse.pulse", getNestedObject(json, "pulse"), {
        required: {
          activeSignals: isNumber,
          agentsOnline: isNumber,
          postsPerHour: isNumber,
          dataSources: isNumber,
          signalAgentRunning: isBoolean,
          lastSynthesisAt: isNumber,
        },
      }));

      checks.push(validateShapeFromMaybeObject("ConvergenceResponse.mindshare", getNestedObject(json, "mindshare"), {
        required: {
          buckets: isArray,
          series: isArray,
        },
      }));

      const firstSeries = getArrayItem(getNestedValue(getNestedObject(json, "mindshare"), "series"));
      checks.push(validateShapeFromMaybeObject("ConvergenceResponse.mindshare.series[]", firstSeries, {
        required: {
          topic: isString,
          shortTopic: isString,
          direction: isString,
          agentCount: isNumber,
          totalAgents: isNumber,
          totalPosts: isNumber,
          agrees: isNumber,
          disagrees: isNumber,
          counts: isArray,
          sourceTxHashes: isStringArray,
          assets: isStringArray,
          confidence: isNumber,
        },
      }));

      checks.push(validateShapeFromMaybeObject("ConvergenceResponse.stats", getNestedObject(json, "stats"), {
        required: {
          totalPosts: isNumber,
          totalAgents: isNumber,
          totalAssets: isNumber,
        },
      }));

      return checks;
    },
  },
  {
    name: "OracleResult",
    path: "/api/oracle",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("OracleResult", json, {
          required: {
            overallSentiment: isObject,
            assets: isArray,
            polymarket: isObject,
            divergences: isArray,
            meta: isObject,
          },
        }),
      ];

      const firstAsset = getArrayItem(json.assets);
      checks.push(validateShapeFromMaybeObject("OracleResult.assets[]", firstAsset, {
        required: {
          ticker: isString,
          postCount: isNumber,
          price: isObject,
          sparkline: isArray,
          sentiment: isObject,
          sentimentTimeline: isArray,
          predictions: isObject,
          polymarketOdds: isArray,
        },
      }));

      checks.push(validateShapeFromMaybeObject("OracleResult.meta", getNestedObject(json, "meta"), {
        required: {
          pricesFetchedAt: isNumber,
          pricesStale: isBoolean,
          computedAt: isNumber,
          ragAvailable: isBoolean,
          window: isString,
        },
      }));

      checks.push(validateShapeFromMaybeObject("OracleResult.assets[].price", getNestedObject(firstAsset, "price"), {
        required: {
          usd: isNumber,
          change24h: isNumber,
          high24h: isNumber,
          low24h: isNumber,
          volume24h: isNumber,
          marketCap: isNumber,
          dahrTxHash: isNullableString,
          source: isString,
        },
      }));

      checks.push(validateShapeFromMaybeObject("OracleResult.assets[].sentiment", getNestedObject(firstAsset, "sentiment"), {
        required: {
          direction: isString,
          score: isNumber,
          agentCount: isNumber,
          confidence: isNumber,
          topPosts: isArray,
        },
      }));

      return checks;
    },
  },
  {
    name: "AgentList",
    path: "/api/agents",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("AgentListResponse", json, {
          required: {
            agents: isArray,
            total: isNumber,
          },
        }),
      ];

      const firstAgent = getArrayItem(json.agents);
      checks.push(validateShapeFromMaybeObject("AgentProfile", firstAgent, {
        required: {
          address: isString,
          name: isString,
          description: isString,
          specialties: isStringArray,
          postCount: isNumber,
          lastActiveAt: isNumber,
          displayName: isString,
          registeredAt: isNumber,
          lastSeen: isNumber,
          nameChangedAt: isNumber,
          categoryBreakdown: isObject,
          web2Identities: isArray,
          xmIdentities: isArray,
          swarmOwner: isNullableString,
        },
      }));

      return checks;
    },
  },
  {
    name: "NetworkStats",
    path: "/api/stats",
    validate: (json: JsonObject): ShapeCheck[] => [
      validateShape("NetworkStats", json, {
        required: {
          network: isObject,
          activity: isObject,
          quality: isObject,
          predictions: isObject,
          tips: isObject,
          consensus: isObject,
          content: isObject,
          computedAt: isNumber,
        },
      }),
      validateShapeFromMaybeObject("NetworkStats.network", getNestedObject(json, "network"), {
        required: {
          totalPosts: isNumber,
          totalAgents: isNumber,
          registeredAgents: isNumber,
          lastBlock: isNumber,
        },
      }),
      validateShapeFromMaybeObject("NetworkStats.content", getNestedObject(json, "content"), {
        required: {
          categories: isArray,
          reports: isNumber,
        },
      }),
    ],
  },
  {
    name: "BettingPool",
    path: "/api/bets/pool?asset=BTC&horizon=30m",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("BettingPool", json, {
          required: {
            asset: isString,
            horizon: isString,
            totalBets: isNumber,
            totalDem: isNumber,
            poolAddress: isString,
            roundEnd: isNumber,
            bets: isArray,
          },
        }),
      ];

      const firstBet = getArrayItem(json.bets);
      checks.push(validateShapeFromMaybeObject("BettingPool.bets[]", firstBet, {
        required: {
          txHash: isString,
          bettor: isString,
          predictedPrice: isNumber,
          amount: isNumber,
          roundEnd: isNumber,
          horizon: isString,
        },
      }));

      return checks;
    },
  },
  {
    name: "HigherLowerPool",
    path: "/api/bets/higher-lower/pool?asset=BTC&horizon=30m",
    validate: (json: JsonObject): ShapeCheck[] => [
      validateShape("HigherLowerPool", json, {
        required: {
          asset: isString,
          horizon: isString,
          totalHigher: isNumber,
          totalLower: isNumber,
          totalDem: isNumber,
          higherCount: isNumber,
          lowerCount: isNumber,
          roundEnd: isNumber,
          referencePrice: isNullableNumber,
          poolAddress: isString,
          currentPrice: isNumber,
        },
      }),
    ],
  },
  {
    name: "BinaryPoolsResponse",
    path: "/api/bets/binary/pools",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("BinaryPoolsResponse", json, {
          required: {
            pools: isObject,
            count: isNumber,
          },
        }),
      ];

      const pools = getNestedObject(json, "pools");
      const firstPool = pools ? getFirstRecordValue(pools) : undefined;
      checks.push(validateShapeFromMaybeObject("BinaryPool", firstPool, {
        required: {
          marketId: isString,
          totalYes: isNumber,
          totalNo: isNumber,
          totalDem: isNumber,
          yesBetsCount: isNumber,
          noBetsCount: isNumber,
          yesMultiplier: isNullableNumber,
          noMultiplier: isNullableNumber,
          polymarketYes: isNumber,
          polymarketNo: isNumber,
          endDate: isString,
          poolAddress: isString,
          status: isString,
        },
      }));

      return checks;
    },
  },
  ...(includeEthBets ? [
    {
      name: "EthBettingPool",
      path: "/api/bets/eth/pool?asset=BTC&horizon=30m",
      validate: (json: JsonObject): ShapeCheck[] => [
        validateShape("EthBettingPool", json, {
          required: {
            totalEth: isNumber,
            totalEthWei: isString,
            totalBets: isNumber,
            asset: isString,
            horizon: isString,
            contractAddress: isString,
            roundEnd: isNumber,
            bets: isArray,
          },
        }),
      ],
    },
    {
      name: "EthWinnersResponse",
      path: "/api/bets/eth/winners?asset=BTC",
      validate: (json: JsonObject): ShapeCheck[] => {
        const checks = [
          validateShape("EthWinnersResponse", json, {
            required: {
              winners: isArray,
              count: isNumber,
            },
          }),
        ];

        const firstWinner = getArrayItem(json.winners);
        checks.push(validateShapeFromMaybeObject("EthWinner", firstWinner, {
          required: {
            txHash: isString,
            asset: isString,
            bettor: isString,
            evmAddress: isString,
            predictedPrice: isNumber,
            actualPrice: isNumber,
            amount: isString,
            amountEth: isNumber,
            payout: isString,
            payoutEth: isNumber,
            roundEnd: isNumber,
            horizon: isString,
            timestamp: isNumber,
          },
        }));

        return checks;
      },
    },
    {
      name: "EthHigherLowerPool",
      path: "/api/bets/eth/hl/pool?asset=BTC&horizon=30m",
      validate: (json: JsonObject): ShapeCheck[] => [
        validateShape("EthHigherLowerPool", json, {
          required: {
            totalEth: isNumber,
            totalEthWei: isString,
            totalHigher: isNumber,
            totalHigherWei: isString,
            totalLower: isNumber,
            totalLowerWei: isString,
            higherCount: isNumber,
            lowerCount: isNumber,
            asset: isString,
            horizon: isString,
            contractAddress: isString,
            roundEnd: isNumber,
            referencePrice: isNullableNumber,
            currentPrice: isNumber,
          },
        }),
      ],
    },
    {
      name: "EthBinaryPoolsResponse",
      path: "/api/bets/eth/binary/pools",
      validate: (json: JsonObject): ShapeCheck[] => {
        const checks = [
          validateShape("EthBinaryPoolsResponse", json, {
            required: {
              pools: isObject,
              count: isNumber,
              enabled: isBoolean,
            },
          }),
        ];

        const pools = getNestedObject(json, "pools");
        const firstPool = pools ? getFirstRecordValue(pools) : undefined;
        checks.push(validateShapeFromMaybeObject("EthBinaryPool", firstPool, {
          required: {
            poolAddress: isString,
            polymarketYes: isNumber,
            polymarketNo: isNumber,
            endDate: isString,
            status: isString,
          },
        }));

        return checks;
      },
    },
  ] : []),
  ...(includeSportsCommodity ? [
    {
      name: "SportsMarketsResponse",
      path: "/api/bets/sports/markets?status=upcoming",
      validate: (json: JsonObject): ShapeCheck[] => {
        const checks = [
          validateShape("SportsMarketsResponse", json, {
            required: {
              markets: isArray,
              poolAddress: isString,
            },
          }),
        ];

        const firstMarket = getArrayItem(json.markets);
        checks.push(validateShapeFromMaybeObject("SportsMarket", firstMarket, {
          required: {
            fixtureId: isString,
            fixture: isObject,
            winnerPool: isObject,
            scorePool: isObject,
          },
        }));

        checks.push(validateShapeFromMaybeObject("SportsFixture", getNestedObject(firstMarket, "fixture"), {
          required: {
            id: isString,
            sport: isString,
            league: isString,
            homeTeam: isString,
            awayTeam: isString,
            homeScore: isNullableNumber,
            awayScore: isNullableNumber,
            status: isString,
            startTime: isNumber,
            endTime: isNullableNumber,
            metadata: isString,
          },
        }));

        checks.push(validateShapeFromMaybeObject("SportsWinnerPool", getNestedObject(firstMarket, "winnerPool"), {
          required: {
            home: isNumber,
            draw: isNumber,
            away: isNumber,
            totalDem: isNumber,
            totalBets: isNumber,
            homeBets: isNumber,
            drawBets: isNumber,
            awayBets: isNumber,
          },
        }));

        checks.push(validateShapeFromMaybeObject("SportsScorePool", getNestedObject(firstMarket, "scorePool"), {
          required: {
            totalDem: isNumber,
            totalBets: isNumber,
            predictions: isArray,
          },
        }));

        return checks;
      },
    },
    {
      name: "SportsPool",
      path: "/api/bets/sports/pool?fixtureId=nba_espn_401866757",
      validate: (json: JsonObject): ShapeCheck[] => {
        const checks = [
          validateShape("SportsPool", json, {
            required: {
              fixtureId: isString,
              fixture: isObject,
              winnerPool: isObject,
              scorePool: isObject,
              poolAddress: isString,
            },
          }),
        ];

        checks.push(validateShapeFromMaybeObject("SportsPool.fixture", getNestedObject(json, "fixture"), {
          required: {
            id: isString,
            sport: isString,
            league: isString,
            homeTeam: isString,
            awayTeam: isString,
            homeScore: isNullableNumber,
            awayScore: isNullableNumber,
            status: isString,
            startTime: isNumber,
            endTime: isNullableNumber,
            metadata: isString,
          },
        }));

        checks.push(validateShapeFromMaybeObject("SportsPool.winnerPool", getNestedObject(json, "winnerPool"), {
          required: {
            home: isNumber,
            draw: isNumber,
            away: isNumber,
            totalDem: isNumber,
            totalBets: isNumber,
            homeBets: isNumber,
            drawBets: isNumber,
            awayBets: isNumber,
          },
        }));

        checks.push(validateShapeFromMaybeObject("SportsPool.scorePool", getNestedObject(json, "scorePool"), {
          required: {
            totalDem: isNumber,
            totalBets: isNumber,
            predictions: isArray,
          },
        }));

        return checks;
      },
    },
    {
      name: "SportsWinnersResponse",
      path: "/api/bets/sports/winners?fixtureId=nba_espn_401866757",
      validate: (json: JsonObject): ShapeCheck[] => [
        validateShape("SportsWinnersResponse", json, {
          required: {
            winners: isArray,
            count: isNumber,
          },
        }),
      ],
    },
    {
      name: "CommodityPool",
      path: "/api/bets/commodity/pool?asset=XAU&horizon=30m",
      validate: (json: JsonObject): ShapeCheck[] => [
        validateShape("CommodityPool", json, {
          required: {
            totalDem: isNumber,
            totalBets: isNumber,
            asset: isString,
            name: isString,
            category: isString,
            unit: isString,
            horizon: isString,
            poolAddress: isString,
            roundEnd: isNumber,
            currentPrice: isNumber,
            bets: isArray,
          },
        }),
      ],
    },
  ] : []),
  ...(includeIntelligence ? [
    {
      name: "PredictionIntelligenceResponse",
      path: "/api/predictions/intelligence?limit=5&stats=true",
      validate: (json: JsonObject): ShapeCheck[] => {
        const checks = [
          validateShape("PredictionIntelligenceResponse", json, {
            required: {
              scores: isArray,
              total: isNumber,
              lastScoredAt: isNumber,
              engineVersion: isString,
              stats: isObject,
            },
          }),
        ];

        const firstScore = getArrayItem(json.scores);
        checks.push(validateShapeFromMaybeObject("PredictionIntelligenceScore", firstScore, {
          required: {
            marketId: isString,
            question: isString,
            category: isString,
            currentPrice: isNumber,
            eloProb: isNullableNumber,
            gbsProb: isNullableNumber,
            mirofishProb: isNullableNumber,
            ensembleProb: isNumber,
            edge: isNumber,
            edgeSide: isString,
            ev: isNumber,
            kellyFraction: isNumber,
            kellySize: isNumber,
            strategies: isStringArray,
            scoredAt: isNumber,
          },
        }));

        checks.push(validateShapeFromMaybeObject("PredictionIntelligenceStats", getNestedObject(json, "stats"), {
          required: {
            totalMarketsScored: isNumber,
            marketsWithEdge: isNumber,
            recommendationsGenerated: isNumber,
            resolvedMarkets: isNumber,
            weights: isObject,
            lastScoredAt: isNumber,
            engineVersion: isString,
            pipelineDurationMs: isNumber,
          },
        }));

        checks.push(validateShapeFromMaybeObject("PredictionIntelligenceWeights", getNestedObject(getNestedObject(json, "stats"), "weights"), {
          required: {
            elo: isObject,
            gbs: isObject,
            mirofish: isObject,
            warmup: isBoolean,
            updatedAt: isNumber,
          },
        }));

        return checks;
      },
    },
    {
      name: "PredictionRecommendationsResponse",
      path: "/api/predictions/recommend?userAddress=demo",
      validate: (json: JsonObject): ShapeCheck[] => {
        const checks = [
          validateShape("PredictionRecommendationsResponse", json, {
            required: {
              recommendations: isArray,
              total: isNumber,
              bankroll: isNumber,
              openExposure: isNumber,
              varHeadroom: isNumber,
              lastScoredAt: isNumber,
              engineVersion: isString,
            },
          }),
        ];

        const firstRecommendation = getArrayItem(json.recommendations);
        checks.push(validateShapeFromMaybeObject("PredictionRecommendation", firstRecommendation, {
          required: {
            marketId: isString,
            question: isString,
            category: isString,
            side: isString,
            ensembleProb: isNumber,
            marketPrice: isNumber,
            edge: isNumber,
            ev: isNumber,
            kellyFraction: isNumber,
            suggestedBet: isNumber,
            confidenceTier: isString,
            strategies: isStringArray,
            betPayload: isObject,
          },
        }));

        checks.push(validateShapeFromMaybeObject("PredictionRecommendation.betPayload", getNestedObject(firstRecommendation, "betPayload"), {
          required: {
            marketId: isString,
            direction: isString,
            amount: isNumber,
          },
        }));

        return checks;
      },
    },
  ] : []),
  ...(includeBetRegistration ? [
    {
      name: "BetRegistrationResponse",
      path: "/api/bets/place",
      method: "POST" as const,
      body: {
        txHash: "a".repeat(64),
        asset: "BTC",
        predictedPrice: 70_000,
        horizon: "30m",
      },
      validate: (json: JsonObject): ShapeCheck[] => [
        validateShape("BetRegistrationResponse", json, {
          required: {
            ok: isBoolean,
            txHash: isString,
            asset: isString,
            predictedPrice: isNumber,
            amount: isNumber,
            message: isString,
          },
        }),
      ],
    },
    {
      name: "HigherLowerRegistrationResponse",
      path: "/api/bets/higher-lower/place",
      method: "POST" as const,
      body: {
        txHash: "a".repeat(64),
        asset: "BTC",
        direction: "HIGHER",
        horizon: "30m",
      },
      validate: (json: JsonObject): ShapeCheck[] => [
        validateShape("HigherLowerRegistrationResponse", json, {
          required: {
            ok: isBoolean,
            txHash: isString,
            asset: isString,
            direction: isString,
            horizon: isString,
            amount: isNumber,
            message: isString,
          },
        }),
      ],
    },
  ] : []),
  {
    name: "PricesResponse",
    path: "/api/prices?assets=BTC",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("PricesResponse", json, {
          required: {
            prices: isArray,
            fetchedAt: isNumber,
            stale: isBoolean,
          },
        }),
      ];

      const firstPrice = getArrayItem(json.prices);
      checks.push(validateShapeFromMaybeObject("PriceData", firstPrice, {
        required: {
          ticker: isString,
          symbol: isString,
          priceUsd: isNumber,
          change24h: isNumber,
          high24h: isNumber,
          low24h: isNumber,
          volume24h: isNumber,
          marketCap: isNumber,
          fetchedAt: isNumber,
          dahrTxHash: isNullableString,
          dahrResponseHash: isNullableString,
          source: isString,
        },
      }));

      return checks;
    },
  },
  {
    name: "ReportResponse",
    path: "/api/report",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("ReportResponse", json, {
          required: {
            id: isNumber,
            title: isString,
            summary: isString,
            script: isObject,
            audioUrl: isString,
            signalCount: isNumber,
            postCount: isNumber,
            agentCount: isNumber,
            sources: isArray,
            status: isString,
            createdAt: isNumber,
            publishedAt: isNumber,
          },
        }),
      ];

      checks.push(validateShapeFromMaybeObject("ReportResponse.script", getNestedObject(json, "script"), {
        required: {
          title: isString,
          summary: isString,
          duration_estimate: isString,
          segments: isArray,
          highlights: isArray,
        },
      }));

      const firstSource = getArrayItem(json.sources);
      checks.push(validateShapeFromMaybeObject("ReportResponse.sources[]", firstSource, {
        required: {
          url: isString,
          txHash: isString,
          timestamp: isNumber,
        },
      }));

      return checks;
    },
  },
  {
    name: "LeaderboardResult",
    path: "/api/scores/agents?limit=1",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("LeaderboardResult", json, {
          required: {
            agents: isArray,
            count: isNumber,
            globalAvg: isNumber,
            confidenceThreshold: isNumber,
          },
        }),
      ];

      const firstAgent = getArrayItem(json.agents);
      checks.push(validateShapeFromMaybeObject("LeaderboardResult.agents[]", firstAgent, {
        required: {
          address: isString,
          name: isString,
          totalPosts: isNumber,
          avgScore: isNumber,
          bayesianScore: isNumber,
          topScore: isNumber,
          lowScore: isNumber,
          lastActiveAt: isNumber,
        },
      }));

      return checks;
    },
  },
  {
    name: "PredictionMarketsResponse",
    path: "/api/predictions/markets?limit=1",
    validate: (json: JsonObject): ShapeCheck[] => {
      const checks = [
        validateShape("PredictionMarketsResponse", json, {
          required: {
            predictions: isArray,
            count: isNumber,
            categories: isStringArray,
          },
          optional: {
            total: isNumber,
          },
        }),
      ];

      const firstPrediction = getArrayItem(json.predictions);
      checks.push(validateShapeFromMaybeObject("PredictionMarket", firstPrediction, {
        required: {
          marketId: isString,
          question: isString,
          category: isString,
          outcomeYes: isNumber,
          outcomeNo: isNumber,
          volume: isNumber,
          liquidity: isNumber,
          endDate: isString,
          lastUpdated: isNumber,
        },
      }));

      return checks;
    },
  },
  {
    name: "HealthStatus",
    path: "/api/health",
    validate: (json: JsonObject): ShapeCheck[] => [
      validateShape("HealthStatus", json, {
        required: {
          status: isString,
          uptime: isNumber,
          timestamp: isNumber,
          memory: isObject,
        },
      }),
      validateShapeFromMaybeObject("HealthStatus.memory", getNestedObject(json, "memory"), {
        required: {
          heapUsed: isNumber,
          rss: isNumber,
        },
      }),
    ],
  },
] as const;

const responses = await Promise.all(
  endpoints.map((endpoint) => fetchText(endpoint.path, {
    baseUrl,
    timeoutMs,
    accept: "application/json",
    method: endpoint.method,
    body: endpoint.body,
  })),
);

const results: EndpointResult[] = endpoints.map((endpoint, index) => {
  const response = responses[index];
  if (!response.ok) {
    return {
      name: endpoint.name,
      path: endpoint.path,
      method: endpoint.method ?? "GET",
      httpStatus: response.status,
      ok: false,
      parseOk: false,
      error: response.error ?? `unexpected HTTP status ${response.status}`,
      checks: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch (error) {
    return {
      name: endpoint.name,
      path: endpoint.path,
      method: endpoint.method ?? "GET",
      httpStatus: response.status,
      ok: false,
      parseOk: false,
      error: error instanceof Error ? error.message : String(error),
      checks: [],
    };
  }

  if (!isObject(parsed)) {
    return {
      name: endpoint.name,
      path: endpoint.path,
      httpStatus: response.status,
      ok: false,
      parseOk: true,
      error: "response is not a JSON object",
      checks: [],
    };
  }

  const checks = endpoint.validate(parsed);
  return {
    name: endpoint.name,
    path: endpoint.path,
    method: endpoint.method ?? "GET",
    httpStatus: response.status,
    parseOk: true,
    ok: checks.every((check) => check.ok || check.skipped),
    checks,
  };
});

const ok = results.every((result) => result.ok);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  baseUrl,
  ok,
  results,
}, null, 2));

process.exit(ok ? 0 : 1);

function validateShape(label: string, value: unknown, spec: ShapeSpec): ShapeCheck {
  if (!isObject(value)) {
    return {
      label,
      ok: false,
      missingKeys: [],
      extraKeys: [],
      typeErrors: [`expected object, got ${describeValue(value)}`],
    };
  }

  const requiredEntries = Object.entries(spec.required);
  const optionalEntries = Object.entries(spec.optional ?? {});
  const allowedKeys = new Set([
    ...requiredEntries.map(([key]) => key),
    ...optionalEntries.map(([key]) => key),
  ]);
  const actualKeys = Object.keys(value);

  const missingKeys = requiredEntries
    .map(([key]) => key)
    .filter((key) => !(key in value));
  const extraKeys = spec.allowExtra
    ? []
    : actualKeys.filter((key) => !allowedKeys.has(key)).sort();
  const typeErrors = [...requiredEntries, ...optionalEntries]
    .filter(([key]) => key in value)
    .filter(([key, validator]) => !validator((value as JsonObject)[key]))
    .map(([key]) => `${key}: ${describeValue((value as JsonObject)[key])}`);

  return {
    label,
    ok: missingKeys.length === 0 && extraKeys.length === 0 && typeErrors.length === 0,
    missingKeys,
    extraKeys,
    typeErrors,
  };
}

function validateShapeFromMaybeObject(label: string, value: unknown, spec: ShapeSpec): ShapeCheck {
  if (!isObject(value)) {
    return {
      label,
      ok: true,
      skipped: true,
      reason: "sample object not present in live response",
      missingKeys: [],
      extraKeys: [],
      typeErrors: [],
    };
  }

  return validateShape(label, value, spec);
}

function getArrayItem(value: unknown): unknown {
  return Array.isArray(value) && value.length > 0 ? value[0] : undefined;
}

function getFirstRecordValue(value: JsonObject): unknown {
  const firstKey = Object.keys(value)[0];
  return firstKey ? value[firstKey] : undefined;
}

function getNestedValue(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function getNestedObject(value: unknown, key: string): JsonObject | undefined {
  const nested = getNestedValue(value, key);
  return isObject(nested) ? nested : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
