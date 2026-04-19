import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildResearchOpportunityFrontier,
  observe,
} from "../../packages/omniweb-toolkit/assets/research-agent-starter.ts";

const originalFetch = globalThis.fetch;

function makeOmni(): any {
  return {
    colony: {
      getFeed: async () => ({
        ok: true,
        data: {
          posts: [
            {
              txHash: "0xfeed1",
              payload: {
                cat: "FEED",
                text: "ETH dominates the macro conversation again.",
              },
              author: "0xabc",
              timestamp: Date.UTC(2026, 3, 17, 14, 0, 0),
            },
          ],
        },
      }),
      getSignals: async () => ({
        ok: true,
        data: [
          {
            shortTopic: "BTC Funding Rate Contrarian",
            text: "Derivatives positioning looks more bearish than spot action currently justifies.",
            confidence: 76,
            direction: "bearish",
            keyInsight: "Funding is rolling over while the colony still has mixed conviction on whether spot can absorb it.",
            agentCount: 4,
            totalAgents: 4,
            tags: ["BTC", "funding", "sentiment"],
            assets: ["BTC"],
            sourcePostData: [
              {
                txHash: "0xsig1",
                author: "0xagent1",
                text: "Funding is rolling over while open interest stays elevated.",
                cat: "ANALYSIS",
                timestamp: Date.UTC(2026, 3, 17, 13, 0, 0),
                confidence: 82,
                reactions: { agree: 2, disagree: 0, flag: 0 },
                dissents: false,
              },
              {
                txHash: "0xsig2",
                author: "0xagent2",
                text: "Price still looks resilient enough that the bearish read may be early.",
                cat: "ANALYSIS",
                timestamp: Date.UTC(2026, 3, 17, 13, 15, 0),
                confidence: 70,
                reactions: { agree: 0, disagree: 1, flag: 0 },
                dissents: true,
              },
            ],
            crossReferences: [
              {
                type: "cross_asset",
                description: "BTC positioning stress is also showing up in dollar-liquidity discussions.",
                assets: ["BTC", "DXY"],
              },
            ],
            reactionSummary: {
              totalAgrees: 2,
              totalDisagrees: 1,
              totalFlags: 0,
            },
            divergence: {
              agent: "0xagent2",
              direction: "bullish",
              reasoning: "Spot still looks resilient enough to absorb the derivatives pressure.",
            },
          },
        ],
      }),
      getLeaderboard: async () => ({
        ok: true,
        data: [{ address: "0x1" }, { address: "0x2" }],
      }),
      getBalance: async () => ({
        ok: true,
        data: { balance: 25 },
      }),
    },
    runtime: {
      llmProvider: {
        name: "test-provider",
        complete: async () =>
          "BTC Sentiment vs Funding is still undercovered even though the colony packet carries a 76-confidence bearish signal and recent feed coverage keeps drifting elsewhere. " +
          "That combination makes the gap durable rather than accidental, especially with the latest sampled posts failing to engage it directly. " +
          "A live publish should anchor on CoinGecko Simple Price and cross-check Blockchain.com Ticker before pushing beyond this scoped claim, and the next attested fetch should confirm whether sentiment, funding, and price action are actually converging or still pulling apart.",
      },
    },
  };
}

describe("research-agent starter", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not skip just because the last publish was recent", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markPrice: "67250.00",
          indexPrice: "67245.12",
          lastFundingRate: "-0.012",
          interestRate: "0.0001",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const omni = makeOmni();
    omni.runtime.llmProvider.complete = async () =>
      "BTC funding positioning still deserves a fresh publish because mark price is holding near 67,250 dollars while the funding read is already around -0.012, so the bearish read in signals is being tested by the derivatives tape instead of simply repeated. " +
      "That mismatch is the actual observation, and it is grounded in the fetched market chart rather than in internal scoring or feed-gap logic. " +
      "The bearish view only strengthens if price loses the current level on rising turnover instead of stabilizing.";

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-1",
        iteration: 2,
        startedAt: "2026-04-17T15:00:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {
          lastCoverageTopic: "older-topic",
          lastPublishedAt: "2026-04-17T14:20:00.000Z",
        },
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("publish");
    if (result.kind !== "publish") throw new Error("expected publish");
    expect(result.text).toContain("67,250");
    expect(result.audit?.promptPacket).toBeDefined();
    expect((result.audit?.promptPacket as { opportunityFrontier?: unknown[] })?.opportunityFrontier?.length).toBeGreaterThan(0);
  });

  it("publishes only when fetched evidence values are available and used in the draft", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markPrice: "67250.00",
          indexPrice: "67245.12",
          lastFundingRate: "-0.012",
          interestRate: "0.0001",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const omni = makeOmni();
    omni.runtime.llmProvider.complete = async () =>
      "BTC funding pressure is leaning bearish because mark price is still sitting near 67,250 dollars while the funding read is already around -0.012. " +
      "That combination matters because it suggests long conviction is fading before spot fully breaks, which is stronger evidence than a vague mood shift across the feed. " +
      "A rebound in the funding read would weaken the thesis, while more compression would confirm downside pressure is still building.";

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-2",
        iteration: 1,
        startedAt: "2026-04-18T08:00:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {},
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("publish");
    if (result.kind !== "publish") throw new Error("expected publish");
    expect(result.text).toContain("67,250");
    expect(result.audit?.selectedEvidence).toHaveProperty("evidenceSummary");
    expect((result.audit?.selectedEvidence as { evidenceSummary?: { values?: Record<string, string> } }).evidenceSummary?.values?.lastFundingRate).toBe("-0.012");
    expect((result.audit?.selectedEvidence as { sourceProfile?: { family?: string } }).sourceProfile?.family).toBe("funding-structure");
    expect((result.audit?.selectedEvidence as { colonySubstrate?: { signalSummary?: { keyInsight?: string | null } } }).colonySubstrate?.signalSummary?.keyInsight)
      .toContain("Funding is rolling over");
    expect((result.audit?.selectedEvidence as { colonySubstrate?: { supportingTakes?: Array<{ textSnippet: string }> } }).colonySubstrate?.supportingTakes?.[0]?.textSnippet)
      .toContain("Funding is rolling over while open interest stays elevated");
    expect((result.audit?.selectedEvidence as { colonySubstrate?: { dissentingTake?: { textSnippet: string } | null } }).colonySubstrate?.dissentingTake?.textSnippet)
      .toContain("Price still looks resilient enough");
    expect(result.nextState).toHaveProperty("publishHistory");
    expect((result.nextState as { publishHistory?: Array<{ family: string | null; textSnippet: string | null }> }).publishHistory?.[0]).toMatchObject({
      family: "funding-structure",
    });
  });

  it("keeps working when the optional leaderboard read fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markPrice: "67250.00",
          indexPrice: "67245.12",
          lastFundingRate: "-0.012",
          interestRate: "0.0001",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const omni = makeOmni();
    omni.colony.getLeaderboard = async () => {
      throw new Error("leaderboard temporarily unavailable");
    };
    omni.runtime.llmProvider.complete = async () =>
      "BTC funding pressure is leaning bearish because mark price is still sitting near 67,250 dollars while the funding read is already around -0.012. " +
      "That combination matters because it suggests long conviction is fading before spot fully breaks, which is stronger evidence than a vague mood shift across the feed. " +
      "A rebound in the funding read would weaken the thesis, while more compression would confirm downside pressure is still building.";

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-3",
        iteration: 1,
        startedAt: "2026-04-18T08:00:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {},
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("publish");
    if (result.kind !== "publish") throw new Error("expected publish");
    expect(result.facts).toMatchObject({
      leaderboard: "leaderboard temporarily unavailable",
    });
  });

  it("skips before prompting when the same topic stays within normal range", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markPrice: "67250.20",
          indexPrice: "67245.22",
          lastFundingRate: "-0.0120",
          interestRate: "0.0001",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const omni = makeOmni();
    const provider = vi.fn().mockResolvedValue(
      "This should never be called because the data-level skip should trigger first.",
    );
    omni.runtime.llmProvider.complete = provider;

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-4",
        iteration: 2,
        startedAt: "2026-04-18T08:15:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {
          lastResearchSnapshot: {
            topic: "btc funding rate contrarian",
            observedAt: "2026-04-18T08:00:00.000Z",
            evidenceValues: {
              markPrice: "67250.00",
              indexPrice: "67245.12",
              lastFundingRate: "-0.012",
              interestRate: "0.0001",
            },
            derivedMetrics: {
              highConfidenceSignalCount: 1,
              coverageGapCount: 1,
              contradictionCount: 0,
              staleTopicCount: 0,
              feedCoverageRatio: 0,
            },
          },
        },
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("skip");
    if (result.kind !== "skip") throw new Error("expected skip");
    expect(result.reason).toBe("values_within_normal_range");
    expect(provider).not.toHaveBeenCalled();
    expect(result.audit?.selectedEvidence).toHaveProperty("evidenceDelta");
  });

  it("skips unsupported research families before trying to fetch mismatched evidence", async () => {
    const omni = makeOmni();
    omni.colony.getSignals = async () => ({
      ok: true,
      data: [
        {
          shortTopic: "ETH ETF Flows",
          confidence: 82,
          direction: "bullish",
        },
      ],
    });

    const provider = vi.fn().mockResolvedValue("This should never be called.");
    omni.runtime.llmProvider.complete = provider;

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-5",
        iteration: 1,
        startedAt: "2026-04-18T08:20:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {},
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("skip");
    if (result.kind !== "skip") throw new Error("expected skip");
    expect(result.reason).toBe("no_publishable_research_opportunity");
    expect(result.facts).toMatchObject({
      signalCount: 1,
      highConfidenceSignalCount: 1,
    });
    expect((result.facts as Record<string, unknown>)?.researchFamily).toBeUndefined();
    expect(provider).not.toHaveBeenCalled();
  });

  it("does not self-history-skip a distinct same-family topic when the evidence packet is unchanged", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markPrice: "67250.00",
          indexPrice: "67245.12",
          lastFundingRate: "-0.012",
          interestRate: "0.0001",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const omni = makeOmni();
    const provider = vi.fn().mockResolvedValue(
      "Funding pressure is still worth writing about because the colony is now debating whether the bearish read is early, not restating the last setup. " +
      "The packet is unchanged, but the topic moved from the prior generic funding take into a narrower question about positioning persistence. " +
      "The idea fails if the same derivatives pressure resolves without spot resilience breaking."
    );
    omni.runtime.llmProvider.complete = provider;

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-5b",
        iteration: 2,
        startedAt: "2026-04-18T12:00:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {
          publishHistory: [
            {
              topic: "btc funding previous take",
              family: "funding-structure",
              publishedAt: "2026-04-18T10:30:00.000Z",
              opportunityKind: "coverage_gap",
              textSnippet: "Earlier funding take.",
              evidenceValues: {
                markPrice: "67250.00",
                indexPrice: "67245.12",
                lastFundingRate: "-0.012",
                interestRate: "0.0001",
              },
            },
          ],
        },
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("skip");
    if (result.kind !== "skip") throw new Error("expected skip");
    expect(result.reason).not.toBe("recent_self_coverage_without_new_delta");
    expect(provider).toHaveBeenCalledTimes(1);
    expect((result.audit?.selectedEvidence as { selfHistory?: { skipSuggested?: boolean; repetitionReason?: string | null } }).selfHistory).toMatchObject({
      skipSuggested: false,
      repetitionReason: "recent_same_family_coverage",
    });
  });

  it("skips a rapid same-family follow-up during the research cooldown", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markPrice: "67250.00",
          indexPrice: "67245.12",
          lastFundingRate: "-0.012",
          interestRate: "0.0001",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const omni = makeOmni();
    const provider = vi.fn().mockResolvedValue("This should not be called while cooldown is active for the same family.");
    omni.runtime.llmProvider.complete = provider;

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-5bb",
        iteration: 2,
        startedAt: "2026-04-18T10:50:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {
          lastPublishedAt: "2026-04-18T10:30:00.000Z",
          publishHistory: [
            {
              topic: "btc funding previous take",
              family: "funding-structure",
              publishedAt: "2026-04-18T10:30:00.000Z",
              opportunityKind: "coverage_gap",
              textSnippet: "Earlier funding take.",
              evidenceValues: {
                markPrice: "67250.00",
                indexPrice: "67245.12",
                lastFundingRate: "-0.012",
                interestRate: "0.0001",
              },
            },
          ],
        },
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("skip");
    if (result.kind !== "skip") throw new Error("expected skip");
    expect(result.reason).toBe("published_within_last_30m");
    expect(provider).not.toHaveBeenCalled();
    expect(result.facts).toMatchObject({
      researchFamily: "funding-structure",
      sameFamilyAsRecentPublish: true,
    });
  });

  it("allows a strong cross-family follow-up to break the research cooldown", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            IBIT: {
              ticker: "IBIT",
              dt: "2026-04-16",
              holdings: 799151.0369,
              change: 1088.1268,
              note: null,
              update_ts: "2026-04-18T07:00:02",
              error: false,
            },
            FBTC: {
              ticker: "FBTC",
              dt: "2026-04-16",
              holdings: 185536.41,
              change: -478.92,
              note: null,
              update_ts: "2026-04-18T07:30:01",
              error: false,
            },
          },
          batch_ts: "2026-04-18T08:00:02",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const omni = makeOmni();
    omni.colony.getSignals = async () => ({
      ok: true,
      data: [
        {
          shortTopic: "BTC ETF Flows",
          text: "ETF absorption is still stronger than the feed is pricing.",
          confidence: 90,
          direction: "bullish",
          keyInsight: "The newer angle is sustained institutional absorption despite mixed feed attention.",
          agentCount: 5,
          totalAgents: 5,
          tags: ["BTC", "ETF", "flows"],
          assets: ["BTC"],
          sourcePostData: [
            {
              txHash: "0xetf1",
              author: "0xagent1",
              text: "IBIT is still leading the inflow complex.",
              cat: "ANALYSIS",
              timestamp: Date.UTC(2026, 3, 18, 7, 30, 0),
              confidence: 86,
              reactions: { agree: 2, disagree: 0, flag: 0 },
              dissents: false,
            },
          ],
          crossReferences: [
            {
              type: "cross_asset",
              description: "BTC spot strength is still being supported by ETF demand.",
              assets: ["BTC"],
            },
          ],
          reactionSummary: {
            totalAgrees: 3,
            totalDisagrees: 0,
            totalFlags: 0,
          },
          divergence: {
            agent: "0xagent2",
            direction: "bearish",
            reasoning: "Spot demand could still fade if the ETF bid slows.",
          },
        },
      ],
    });
    omni.runtime.llmProvider.complete = async () =>
      "BTC ETF demand is still stronger than the feed is pricing because total holdings remain above 984,687 BTC while the aggregate daily flow is still roughly 609.21 BTC. " +
      "IBIT is still carrying the positive side of the tape, which makes the flow picture stronger than a casual headline skim would suggest. " +
      "A decisive flip to net outflows would weaken the thesis, but the current packet still points to absorption rather than release.";

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-5bc",
        iteration: 2,
        startedAt: "2026-04-18T10:50:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {
          lastPublishedAt: "2026-04-18T10:30:00.000Z",
          publishHistory: [
            {
              topic: "btc funding previous take",
              family: "funding-structure",
              publishedAt: "2026-04-18T10:30:00.000Z",
              opportunityKind: "coverage_gap",
              textSnippet: "Earlier funding take.",
              evidenceValues: {
                markPrice: "67250.00",
              },
            },
          ],
        },
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("publish");
    if (result.kind !== "publish") throw new Error("expected publish");
    expect(result.facts).toMatchObject({
      researchFamily: "etf-flows",
      cooldownOverrideApplied: true,
    });
    expect((result.audit?.promptPacket as { opportunityFrontier?: Array<{ topic: string; portfolioScore: number }> }).opportunityFrontier?.[0]?.topic)
      .toBe("btc etf flows");
  });

  it("falls through to the next ranked opportunity when the top topic is a same-topic no-delta repeat", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          markPrice: "67250.00",
          indexPrice: "67245.12",
          lastFundingRate: "-0.012",
          interestRate: "0.0001",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const omni = makeOmni();
    omni.colony.getSignals = async () => ({
      ok: true,
      data: [
        {
          shortTopic: "BTC Funding Rate Contrarian",
          text: "Derivatives positioning looks more bearish than spot action currently justifies.",
          confidence: 80,
          direction: "bearish",
          keyInsight: "Funding is rolling over while the colony still has mixed conviction on whether spot can absorb it.",
          agentCount: 4,
          totalAgents: 4,
          tags: ["BTC", "funding", "sentiment"],
          assets: ["BTC"],
        },
        {
          shortTopic: "BTC Funding Persistence",
          text: "The market may still be underpricing how persistent the funding stress is.",
          confidence: 74,
          direction: "bearish",
          keyInsight: "The newer debate is whether the same derivatives stress is persisting despite spot resilience.",
          agentCount: 3,
          totalAgents: 3,
          tags: ["BTC", "funding"],
          assets: ["BTC"],
        },
      ],
    });
    omni.runtime.llmProvider.complete = async () =>
      "Funding persistence is the fresher angle because the colony is no longer arguing about whether bearish pressure exists, but whether it is fading or sticking even as spot tries to hold up. " +
      "With mark price still near 67,250 dollars and funding at roughly -0.012, the same derivatives stress remains visible, but the live question has moved to persistence rather than first detection. " +
      "The thesis weakens if funding normalizes quickly while price keeps holding, because that would mean the earlier stress signal is finally resolving instead of lingering.";

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-5c",
        iteration: 3,
        startedAt: "2026-04-18T12:30:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {
          lastResearchSnapshot: {
            topic: "btc funding rate contrarian",
            observedAt: "2026-04-18T12:00:00.000Z",
            evidenceValues: {
              markPrice: "67250.00",
              indexPrice: "67245.12",
              lastFundingRate: "-0.012",
              interestRate: "0.0001",
            },
            derivedMetrics: {
              highConfidenceSignalCount: 1,
              coverageGapCount: 1,
              contradictionCount: 0,
              staleTopicCount: 0,
              feedCoverageRatio: 0,
            },
          },
          publishHistory: [
            {
              topic: "btc funding rate contrarian",
              family: "funding-structure",
              publishedAt: "2026-04-18T12:00:00.000Z",
              opportunityKind: "coverage_gap",
              textSnippet: "Earlier contrarian funding take.",
              evidenceValues: {
                markPrice: "67250.00",
                indexPrice: "67245.12",
                lastFundingRate: "-0.012",
                interestRate: "0.0001",
              },
            },
          ],
        },
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("publish");
    if (result.kind !== "publish") throw new Error("expected publish");
    expect(result.text).toContain("67,250");
    expect((result.audit?.selectedEvidence as { matchedSignal?: { shortTopic?: string | null } }).matchedSignal?.shortTopic)
      .toBe("BTC Funding Persistence");
  });

  it("publishes BTC ETF flow topics through the dedicated ETF evidence family", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            IBIT: {
              ticker: "IBIT",
              dt: "2026-04-16",
              holdings: 799151.0369,
              change: 1088.1268,
              note: null,
              update_ts: "2026-04-17T12:00:02",
              error: false,
            },
            FBTC: {
              ticker: "FBTC",
              dt: "2026-04-16",
              holdings: 185536.41,
              change: -478.92,
              note: null,
              update_ts: "2026-04-17T12:30:01",
              error: false,
            },
          },
          batch_ts: "2026-04-18T07:00:02",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const omni = makeOmni();
    omni.colony.getSignals = async () => ({
      ok: true,
      data: [
        {
          shortTopic: "BTC ETF Flows",
          confidence: 82,
          direction: "bullish",
        },
      ],
    });
    omni.runtime.llmProvider.complete = async () =>
      "BTC ETF demand is still net positive because total holdings sit above 984,687 BTC while the latest daily flow is still roughly 609.21 BTC in aggregate. IBIT is still leading the positive side of the tape, which matters because a single dominant inflow can keep institutional demand firm even when other issuers are leaking coins. A flip to net outflows or a sharp slowdown in the leader's intake would weaken the thesis, but for now the ETF complex is still absorbing supply rather than releasing it.";

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-6",
        iteration: 1,
        startedAt: "2026-04-18T08:25:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {},
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("publish");
    if (result.kind !== "publish") throw new Error("expected publish");
    expect(result.facts).toMatchObject({
      researchFamily: "etf-flows",
    });
    expect((result.audit?.selectedEvidence as { sourceProfile?: { primarySourceIds?: string[] } }).sourceProfile?.primarySourceIds).toEqual(["btcetfdata-current-btc"]);
    expect((result.audit?.selectedEvidence as { evidenceSummary?: { values?: Record<string, string> } }).evidenceSummary?.values?.netFlowBtc).toBe("609.21");
  });

  it("accepts string balances from the live agent balance route", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markPrice: "67250.00",
          indexPrice: "67245.12",
          lastFundingRate: "-0.012",
          interestRate: "0.0001",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const omni = makeOmni();
    omni.colony.getBalance = async () => ({
      ok: true,
      data: { balance: "2762" },
    });
    omni.runtime.llmProvider.complete = async () =>
      "BTC funding pressure is leaning bearish because mark price is still sitting near 67,250 dollars while the funding read is already around -0.012. " +
      "That combination matters because it suggests long conviction is fading before spot fully breaks, which is stronger evidence than a vague mood shift across the feed. " +
      "A rebound in the funding read would weaken the thesis, while more compression would confirm downside pressure is still building.";

    const result = await observe({
      omni,
      cycle: {
        id: "cycle-7",
        iteration: 1,
        startedAt: "2026-04-18T08:30:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {},
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("publish");
    if (result.kind !== "publish") throw new Error("expected publish");
    expect(result.facts).toMatchObject({
      availableBalance: 2762,
    });
  });

  it("prefers a fresher and more diverse follow-up in the opportunity frontier", () => {
    const frontier = buildResearchOpportunityFrontier([
      {
        kind: "coverage_gap",
        topic: "btc funding persistence",
        score: 100,
        rationale: "same-family follow-up",
        sourceProfile: {
          family: "funding-structure",
          topic: "btc funding persistence",
          asset: { asset: "Bitcoin", symbol: "BTC" },
          supported: true,
          reason: null,
          primarySourceIds: ["binance-futures-premium-index"],
          supportingSourceIds: ["binance-futures-open-interest"],
          expectedMetrics: ["markPrice"],
        },
        matchedSignal: {
          topic: "btc funding persistence",
          shortTopic: "BTC Funding Persistence",
          confidence: 82,
          direction: "bearish",
          sourcePostData: [],
        },
        matchingFeedPosts: [],
        lastSeenAt: null,
        contradictionSignals: [],
        attestationPlan: {
          ready: true,
          minSupportingSources: 1,
          preferredSourceIds: ["binance-futures-premium-index"],
          primary: { id: "binance-futures-premium-index", name: "Binance Premium Index" },
          supporting: [{ id: "binance-futures-open-interest", name: "Binance Open Interest" }],
          warnings: [],
        },
      },
      {
        kind: "coverage_gap",
        topic: "btc sentiment vs reality",
        score: 95,
        rationale: "different-family follow-up",
        sourceProfile: {
          family: "spot-momentum",
          topic: "btc sentiment vs reality",
          asset: { asset: "Bitcoin", symbol: "BTC" },
          supported: true,
          reason: null,
          primarySourceIds: ["coingecko-42ff8c85"],
          supportingSourceIds: ["coingecko-2a7ea372"],
          expectedMetrics: ["currentPriceUsd"],
        },
        matchedSignal: {
          topic: "btc sentiment vs reality",
          shortTopic: "BTC Sentiment vs Reality",
          confidence: 78,
          direction: "bearish",
          keyInsight: "The colony is split between narrative calm and actual spot weakness.",
          agentCount: 5,
          sourcePostData: [
            {
              txHash: "0xsig3",
              author: "0xagent3",
              text: "Spot is rolling over faster than sentiment acknowledges.",
              category: "ANALYSIS",
              timestamp: Date.UTC(2026, 3, 19, 6, 30, 0),
              confidence: 81,
              assets: ["BTC"],
              dissents: false,
              reactions: { agree: 3, disagree: 0, flag: 0 },
            },
          ],
          crossReferences: [
            {
              type: "cross_asset",
              description: "Risk appetite is weakening across majors.",
              assets: ["BTC", "ETH"],
            },
          ],
          reactionSummary: {
            totalAgrees: 3,
            totalDisagrees: 0,
            totalFlags: 0,
          },
          divergence: {
            agent: "0xagent4",
            direction: "bullish",
            reasoning: "Sentiment has not broken enough to confirm a trend change.",
          },
        },
        matchingFeedPosts: [],
        lastSeenAt: null,
        contradictionSignals: [],
        attestationPlan: {
          ready: true,
          minSupportingSources: 1,
          preferredSourceIds: ["coingecko-42ff8c85"],
          primary: { id: "coingecko-42ff8c85", name: "CoinGecko Price" },
          supporting: [{ id: "coingecko-2a7ea372", name: "CoinGecko Market Chart" }],
          warnings: [],
        },
      },
    ], {
      publishHistory: [
        {
          topic: "btc funding previous take",
          family: "funding-structure",
          publishedAt: "2026-04-19T05:30:00.000Z",
          opportunityKind: "coverage_gap",
          textSnippet: "Earlier funding take.",
          evidenceValues: {
            markPrice: "67250.00",
          },
        },
      ],
      topicHistory: [
        {
          topic: "btc funding previous take",
          publishedAt: "2026-04-19T05:30:00.000Z",
          opportunityKind: "coverage_gap",
        },
      ],
    }, "2026-04-19T08:00:00.000Z");

    expect(frontier[0]?.topic).toBe("btc sentiment vs reality");
    expect(frontier[0]?.portfolioReasons).toContain("family_diversity");
    expect(frontier[0]?.portfolioReasons).toContain("fresh_evidence");
    expect(frontier[0]?.portfolioReasons).toContain("rich_substrate");
    expect(frontier[1]?.portfolioReasons).toContain("recent_family_penalty");
  });

  it("does not truncate the executable opportunity ranking to the reported frontier size", () => {
    const opportunities = Array.from({ length: 5 }, (_, index) => ({
      kind: "coverage_gap" as const,
      topic: `btc topic ${index + 1}`,
      score: 100 - index,
      rationale: `topic ${index + 1}`,
      sourceProfile: {
        family: index < 4 ? "funding-structure" : "spot-momentum",
        topic: `btc topic ${index + 1}`,
        asset: { asset: "Bitcoin", symbol: "BTC" },
        supported: true,
        reason: null,
        primarySourceIds: ["coingecko-42ff8c85"],
        supportingSourceIds: ["coingecko-2a7ea372"],
        expectedMetrics: ["currentPriceUsd"],
      },
      matchedSignal: {
        topic: `btc topic ${index + 1}`,
        shortTopic: `BTC Topic ${index + 1}`,
        confidence: 80 - index,
        direction: "bearish",
        sourcePostData: index === 4
          ? [{
              txHash: "0xlate",
              author: "0xagent5",
              text: "Late candidate still has live signal support.",
              category: "ANALYSIS",
              timestamp: Date.UTC(2026, 3, 19, 7, 55, 0),
              confidence: 77,
              assets: ["BTC"],
              dissents: false,
              reactions: { agree: 2, disagree: 0, flag: 0 },
            }]
          : [],
      },
      matchingFeedPosts: [],
      lastSeenAt: null,
      contradictionSignals: [],
      attestationPlan: {
        ready: true,
        minSupportingSources: 1,
        preferredSourceIds: ["coingecko-42ff8c85"],
        primary: { id: "coingecko-42ff8c85", name: "CoinGecko Price" },
        supporting: [{ id: "coingecko-2a7ea372", name: "CoinGecko Market Chart" }],
        warnings: [],
      },
    }));

    const frontier = buildResearchOpportunityFrontier(opportunities, {
      publishHistory: [
        {
          topic: "btc topic 0",
          family: "funding-structure",
          publishedAt: "2026-04-19T07:30:00.000Z",
          opportunityKind: "coverage_gap",
          textSnippet: "Earlier funding slice.",
          evidenceValues: { markPrice: "67250.00" },
        },
      ],
    }, "2026-04-19T08:00:00.000Z");

    expect(frontier).toHaveLength(5);
    expect(frontier[4]?.topic).toBe("btc topic 4");
  });
});
