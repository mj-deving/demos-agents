import { afterEach, describe, expect, it, vi } from "vitest";
import { observe } from "../../packages/omniweb-toolkit/assets/research-agent-starter.ts";

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

  it("skips when the same family was just covered without a material evidence delta", async () => {
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
    const provider = vi.fn().mockResolvedValue("This should never be called because recent same-family coverage should skip first.");
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
    expect(result.reason).toBe("recent_self_coverage_without_new_delta");
    expect(provider).not.toHaveBeenCalled();
    expect((result.audit?.selectedEvidence as { selfHistory?: { skipSuggested?: boolean; repetitionReason?: string | null } }).selfHistory).toMatchObject({
      skipSuggested: true,
      repetitionReason: "same_family_no_material_change_within_24h",
    });
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
});
