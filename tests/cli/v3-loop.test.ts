import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  initStrategyBridgeMock,
  senseMock,
  planMock,
  computePerformanceMock,
  executeStrategyActionsMock,
  executePublishActionsMock,
  createSdkBridgeMock,
  runBeforeSenseMock,
  runAfterActMock,
  runAfterConfirmMock,
  beforePublishDraftMock,
  afterPublishDraftMock,
  createUsageTrackerMock,
  loadDeclarativeProviderAdaptersSyncMock,
  appendSessionLogMock,
  logQualityDataMock,
  insertPostMock,
  countPostsMock,
  getRecentPostsMock,
  upsertReactionMock,
  getReactionMock,
  upsertSourceResponseMock,
  getSourceResponseMock,
  deriveIntentsFromTopicsMock,
  deriveIntentsFromSignalTopicsMock,
  selectSourcesByIntentMock,
  fetchSourceMock,
  dataSourceGetRecentPostsMock,
} = vi.hoisted(() => ({
  dataSourceGetRecentPostsMock: vi.fn().mockResolvedValue([]),
  initStrategyBridgeMock: vi.fn(),
  senseMock: vi.fn(),
  planMock: vi.fn(),
  computePerformanceMock: vi.fn(),
  executeStrategyActionsMock: vi.fn(),
  executePublishActionsMock: vi.fn(),
  createSdkBridgeMock: vi.fn(),
  runBeforeSenseMock: vi.fn(),
  runAfterActMock: vi.fn(),
  runAfterConfirmMock: vi.fn(),
  beforePublishDraftMock: vi.fn(),
  afterPublishDraftMock: vi.fn(),
  createUsageTrackerMock: vi.fn(),
  loadDeclarativeProviderAdaptersSyncMock: vi.fn(),
  appendSessionLogMock: vi.fn(),
  logQualityDataMock: vi.fn(),
  insertPostMock: vi.fn(),
  countPostsMock: vi.fn().mockReturnValue(0),
  getRecentPostsMock: vi.fn().mockReturnValue([]),
  upsertReactionMock: vi.fn(),
  getReactionMock: vi.fn().mockReturnValue(null),
  upsertSourceResponseMock: vi.fn(),
  getSourceResponseMock: vi.fn().mockReturnValue(null),
  deriveIntentsFromTopicsMock: vi.fn().mockReturnValue([]),
  deriveIntentsFromSignalTopicsMock: vi.fn().mockReturnValue([]),
  selectSourcesByIntentMock: vi.fn().mockReturnValue([]),
  fetchSourceMock: vi.fn().mockResolvedValue({ ok: false }),
}));

vi.mock("../../cli/v3-strategy-bridge.js", () => ({
  initStrategyBridge: initStrategyBridgeMock,
  sense: senseMock,
  plan: planMock,
  computePerformance: computePerformanceMock,
  computeAutoCalibration: vi.fn(() => ({ ourAvgScore: 0, colonyMedianScore: 0, offset: 0, postCount: 0, computedAt: new Date().toISOString() })),
}));

vi.mock("../../cli/action-executor.js", () => ({
  executeStrategyActions: executeStrategyActionsMock,
}));

vi.mock("../../cli/publish-executor.js", () => ({
  executePublishActions: executePublishActionsMock,
}));

vi.mock("../../src/toolkit/sdk-bridge.js", () => ({
  AUTH_PENDING_TOKEN: "__AUTH_PENDING__",
  createSdkBridge: createSdkBridgeMock,
}));

vi.mock("../../src/lib/util/extensions.js", () => ({
  runBeforeSense: runBeforeSenseMock,
  runAfterAct: runAfterActMock,
  runAfterConfirm: runAfterConfirmMock,
  runBeforePublishDraft: beforePublishDraftMock,
  runAfterPublishDraft: afterPublishDraftMock,
}));

vi.mock("../../src/lib/attestation/attestation-planner.js", () => ({
  createUsageTracker: createUsageTrackerMock,
}));

vi.mock("../../src/lib/sources/providers/declarative-engine.js", () => ({
  loadDeclarativeProviderAdaptersSync: loadDeclarativeProviderAdaptersSyncMock,
}));

vi.mock("../../src/lib/util/log.js", () => ({
  appendSessionLog: appendSessionLogMock,
}));

vi.mock("../../src/lib/scoring/quality-score.js", () => ({
  logQualityData: logQualityDataMock,
}));

vi.mock("../../src/toolkit/colony/posts.js", () => ({
  insertPost: insertPostMock,
  countPosts: countPostsMock,
  getRecentPosts: getRecentPostsMock,
}));

vi.mock("../../src/toolkit/colony/reactions.js", () => ({
  upsertReaction: upsertReactionMock,
  getReaction: getReactionMock,
}));

vi.mock("../../src/toolkit/colony/source-cache.js", () => ({
  upsertSourceResponse: upsertSourceResponseMock,
  getSourceResponse: getSourceResponseMock,
}));

vi.mock("../../src/lib/pipeline/source-scanner.js", () => ({
  deriveIntentsFromTopics: deriveIntentsFromTopicsMock,
  deriveIntentsFromSignalTopics: deriveIntentsFromSignalTopicsMock,
  selectSourcesByIntent: selectSourcesByIntentMock,
}));

vi.mock("../../src/toolkit/sources/fetch.js", () => ({
  fetchSource: fetchSourceMock,
}));

vi.mock("../../src/lib/auth/auth.js", () => ({
  ensureAuth: vi.fn().mockResolvedValue(null),
  loadAuthCache: vi.fn().mockReturnValue(null),
}));

vi.mock("../../src/lib/network/sdk.js", () => ({
  apiCall: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
  info: vi.fn(),
  getApiUrl: vi.fn().mockReturnValue("https://supercolony.ai"),
  getRpcUrl: vi.fn().mockReturnValue("https://demosnode.discus.sh/"),
}));

vi.mock("../../src/toolkit/supercolony/api-client.js", () => {
  class MockApiClient {
    getFeed = vi.fn().mockResolvedValue(null);
    searchFeed = vi.fn().mockResolvedValue(null);
    getPostDetail = vi.fn().mockResolvedValue(null);
    getThread = vi.fn().mockResolvedValue(null);
    getSignals = vi.fn().mockResolvedValue(null);
    getReport = vi.fn().mockResolvedValue(null);
    listAgents = vi.fn().mockResolvedValue(null);
    getAgentProfile = vi.fn().mockResolvedValue(null);
    getAgentLeaderboard = vi.fn().mockResolvedValue(null);
    getOracle = vi.fn().mockResolvedValue(null);
    getPrices = vi.fn().mockResolvedValue(null);
    getBallotAccuracy = vi.fn().mockResolvedValue(null);
    getAgentBalance = vi.fn().mockResolvedValue(null);
    lookupByChainAddress = vi.fn().mockResolvedValue(null);
    initiateTip = vi.fn().mockResolvedValue(null);
  }
  return { SuperColonyApiClient: MockApiClient };
});

vi.mock("../../src/toolkit/data-source.js", () => {
  const makeMockDS = (name: string, getRecent?: any) => class {
    name = name;
    getRecentPosts = getRecent ?? vi.fn().mockResolvedValue([]);
    getPostByHash = vi.fn().mockResolvedValue(null);
    getThread = vi.fn().mockResolvedValue(null);
    getRepliesTo = vi.fn().mockResolvedValue([]);
  };
  return { ApiDataSource: makeMockDS("api"), ChainDataSource: makeMockDS("chain"), AutoDataSource: makeMockDS("auto", dataSourceGetRecentPostsMock) };
});

vi.mock("../../src/toolkit/primitives/index.js", () => ({
  createToolkit: vi.fn().mockReturnValue({
    feed: { getRecent: vi.fn().mockResolvedValue(null), search: vi.fn().mockResolvedValue(null), getPost: vi.fn().mockResolvedValue(null), getThread: vi.fn().mockResolvedValue(null) },
    intelligence: { getSignals: vi.fn().mockResolvedValue(null), getReport: vi.fn().mockResolvedValue(null) },
    scores: { getLeaderboard: vi.fn().mockResolvedValue(null) },
    agents: { list: vi.fn().mockResolvedValue(null), getProfile: vi.fn().mockResolvedValue(null), getIdentities: vi.fn().mockResolvedValue(null) },
    actions: { tip: vi.fn().mockResolvedValue(null) },
    oracle: { get: vi.fn().mockResolvedValue(null) },
    prices: { get: vi.fn().mockResolvedValue(null) },
    verification: { verifyDahr: vi.fn().mockResolvedValue(null), verifyTlsn: vi.fn().mockResolvedValue(null) },
    predictions: { query: vi.fn().mockResolvedValue(null), resolve: vi.fn().mockResolvedValue(null), markets: vi.fn().mockResolvedValue(null) },
    ballot: { getState: vi.fn().mockResolvedValue(null), getAccuracy: vi.fn().mockResolvedValue(null), getLeaderboard: vi.fn().mockResolvedValue(null), getPerformance: vi.fn().mockResolvedValue(null) },
    webhooks: { list: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(null), delete: vi.fn().mockResolvedValue(null) },
    identity: { lookup: vi.fn().mockResolvedValue(null) },
    balance: { get: vi.fn().mockResolvedValue(null) },
    health: { check: vi.fn().mockResolvedValue(null) },
    stats: { get: vi.fn().mockResolvedValue(null) },
  }),
}));

import { runV3Loop, type V3LoopDeps, type V3LoopFlags } from "../../cli/v3-loop.js";
import type { V3SessionState } from "../../src/lib/state.js";

function makeState(): V3SessionState {
  return {
    loopVersion: 3,
    sessionNumber: 9,
    agentName: "sentinel",
    startedAt: "2026-03-31T00:00:00.000Z",
    pid: 123,
    phases: {
      sense: { status: "pending" },
      act: { status: "pending" },
      confirm: { status: "pending" },
    },
    posts: [],
    engagements: [],
  };
}

function makeBridge(disposeSpy: ReturnType<typeof vi.fn> = vi.fn()) {
  return {
    store: { kind: "store" },
    db: {
      kind: "db",
      pragma: vi.fn(),
      transaction: vi.fn((fn: (...args: any[]) => void) => fn),
    },
    [Symbol.dispose]: disposeSpy,
  };
}

function makeFlags(overrides: Partial<V3LoopFlags> = {}): V3LoopFlags {
  return {
    agent: "sentinel",
    env: "/tmp/test.env",
    log: "/tmp/session.jsonl",
    dryRun: false,
    pretty: false,
    shadow: false,
    oversight: "autonomous",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<V3LoopDeps> = {}): V3LoopDeps {
  return {
    runSubprocess: vi.fn().mockImplementation(async (script: string) => {
      if (script === "cli/scan-feed.ts") {
        return { activity: { level: "moderate", posts_per_hour: 5 }, gaps: { topics: ["defi"] } };
      }
      if (script === "cli/verify.ts") {
        return { summary: { verified: 1, total: 1 } };
      }
      return {};
    }),
    connectWallet: vi.fn().mockResolvedValue({ demos: { kind: "demos" }, address: "demos1realwallet" }),
    resolveProvider: vi.fn().mockReturnValue({ kind: "provider" } as any),
    agentConfig: {
      name: "sentinel",
      loopExtensions: ["tips", "predictions"],
      paths: {
        strategyYaml: "/tmp/strategy.yaml",
        improvementsFile: "/tmp/improvements.json",
      },
    } as any,
    getSourceView: vi.fn().mockReturnValue({
      sources: [],
      index: { byId: new Map() },
    } as any),
    observe: vi.fn(),
    ...overrides,
  };
}

describe("runV3Loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const bridge = makeBridge();
    initStrategyBridgeMock.mockReturnValue(bridge);
    senseMock.mockReturnValue({ colonyState: { activity: {} }, evidence: [{ id: "e1" }] });
    planMock.mockResolvedValue({
      actions: [
        { type: "ENGAGE", priority: 90, reason: "engage", target: "0xengage" },
        { type: "PUBLISH", priority: 80, reason: "publish", metadata: { topics: ["defi"] } },
      ],
      log: {},
    });
    computePerformanceMock.mockReturnValue([{ txHash: "0xpub", decayedScore: 12 }]);
    createSdkBridgeMock.mockReturnValue({
      apiCall: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
      publishHivePost: vi.fn(),
      transferDem: vi.fn(),
      getHivePosts: vi.fn().mockResolvedValue([]),
    });
    executeStrategyActionsMock.mockResolvedValue({
      executed: [{ action: { type: "ENGAGE" }, success: true }],
      skipped: [],
    });
    executePublishActionsMock.mockImplementation(async (_actions: unknown, deps: any) => {
      deps.state.posts.push({ txHash: "0xpub", category: "ANALYSIS", text: "text", textLength: 240, topic: "defi" });
      deps.state.publishedPosts = [{
        txHash: "0xpub",
        topic: "defi",
        category: "ANALYSIS",
        text: "text",
        confidence: 80,
        predictedReactions: 12,
        tags: ["defi"],
        publishedAt: "2026-03-31T00:00:00.000Z",
        attestationType: "DAHR",
      }];
      return {
        executed: [{ action: { type: "PUBLISH" }, success: true, txHash: "0xpub" }],
        skipped: [],
      };
    });
    runBeforeSenseMock.mockResolvedValue(undefined);
    runAfterActMock.mockResolvedValue(undefined);
    runAfterConfirmMock.mockResolvedValue(undefined);
    createUsageTrackerMock.mockReturnValue({ kind: "usage-tracker" });
    loadDeclarativeProviderAdaptersSyncMock.mockReturnValue(new Map());
  });

  it("runs the full SENSE -> ACT -> CONFIRM flow with mocked deps", async () => {
    const state = makeState();
    const deps = makeDeps();
    const sessionsDir = mkdtempSync(join(tmpdir(), "v3-loop-"));

    await runV3Loop(state, makeFlags(), sessionsDir, new Map(), deps);

    expect(deps.connectWallet).toHaveBeenCalledWith("/tmp/test.env");
    expect(deps.runSubprocess).toHaveBeenNthCalledWith(1, "cli/scan-feed.ts", ["--agent", "sentinel", "--json", "--env", "/tmp/test.env"], "scan-feed");
    expect(executeStrategyActionsMock).toHaveBeenCalledTimes(1);
    expect(executePublishActionsMock).toHaveBeenCalledTimes(1);
    expect(deps.runSubprocess).toHaveBeenNthCalledWith(2, "cli/verify.ts", ["0xpub", "--json", "--log", "/tmp/session.jsonl", "--env", "/tmp/test.env"], "verify");
    expect(state.phases.sense.status).toBe("completed");
    expect(state.phases.act.status).toBe("completed");
    expect(state.phases.confirm.status).toBe("completed");
    expect(state.strategyResults?.senseResult).toBeDefined();
    expect(state.strategyResults?.planResult).toBeDefined();
    expect(state.strategyResults?.executionResult).toBeDefined();
    expect(state.phases.confirm.result).toEqual({
      verify: { summary: { verified: 1, total: 1 } },
      performance: [{ txHash: "0xpub", decayedScore: 12 }],
    });
  });

  it("resumes from sense completed and only runs act + confirm", async () => {
    const state = makeState();
    state.phases.sense = {
      status: "completed",
      result: {
        scan: { activity: { level: "high", posts_per_hour: 8 }, gaps: { topics: ["ai"] } },
        strategy: { colonyState: { activity: {} }, evidence: [{ id: "e2" }] },
      },
    };
    state.strategyResults = { senseResult: { colonyState: { activity: {} }, evidence: [{ id: "e2" }] } };
    const deps = makeDeps();

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), deps);

    expect(runBeforeSenseMock).not.toHaveBeenCalled();
    expect(senseMock).not.toHaveBeenCalled();
    expect((deps.runSubprocess as any).mock.calls.map((call: any[]) => call[0])).toEqual(["cli/verify.ts"]);
    expect(planMock).toHaveBeenCalledTimes(1);
  });

  it("resumes from act completed and only runs confirm", async () => {
    const state = makeState();
    state.phases.sense = { status: "completed", result: { scan: {}, strategy: {} } };
    state.phases.act = { status: "completed", result: { executed: [], skipped: [] } };
    state.posts = [{ txHash: "0xexisting", category: "ANALYSIS", text: "text", textLength: 220, topic: "defi" }];
    state.publishedPosts = [{
      txHash: "0xexisting",
      topic: "defi",
      category: "ANALYSIS",
      text: "text",
      confidence: 82,
      predictedReactions: 14,
      tags: ["defi"],
      publishedAt: "2026-03-31T00:00:00.000Z",
      attestationType: "DAHR",
    }];
    const deps = makeDeps();

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), deps);

    expect(planMock).not.toHaveBeenCalled();
    expect(executeStrategyActionsMock).not.toHaveBeenCalled();
    expect(executePublishActionsMock).not.toHaveBeenCalled();
    expect((deps.runSubprocess as any).mock.calls.map((call: any[]) => call[0])).toEqual(["cli/verify.ts"]);
    expect(runAfterConfirmMock).toHaveBeenCalledTimes(1);
  });

  it("skips action execution in shadow mode and still passes actResult to afterAct", async () => {
    const state = makeState();
    const deps = makeDeps();

    await runV3Loop(state, makeFlags({ shadow: true }), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), deps);

    expect(executeStrategyActionsMock).not.toHaveBeenCalled();
    expect(executePublishActionsMock).not.toHaveBeenCalled();
    expect(state.publishSuppressed).toBe(true);
    expect(state.phases.act.result).toEqual({ skipped: true, reason: "shadow" });
    expect(runAfterActMock).toHaveBeenCalledWith(expect.anything(), ["tips", "predictions"], expect.objectContaining({
      actResult: { skipped: true, reason: "shadow" },
    }));
  });

  it("records no-actions skip and still runs afterAct", async () => {
    planMock.mockResolvedValueOnce({ actions: [], log: {} });
    const state = makeState();
    const deps = makeDeps();

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), deps);

    expect(executeStrategyActionsMock).not.toHaveBeenCalled();
    expect(executePublishActionsMock).not.toHaveBeenCalled();
    expect(state.phases.act.result).toEqual({ skipped: true, reason: "no actions" });
    expect(runAfterActMock).toHaveBeenCalledWith(expect.anything(), ["tips", "predictions"], expect.objectContaining({
      actResult: { skipped: true, reason: "no actions" },
    }));
    expect(state.phases.confirm.result).toEqual({ skipped: true, reason: "no posts" });
  });

  it("disposes the bridge on success", async () => {
    const disposeSpy = vi.fn();
    initStrategyBridgeMock.mockReturnValueOnce(makeBridge(disposeSpy));
    const state = makeState();

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), makeDeps());

    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("disposes the bridge when the loop throws", async () => {
    const disposeSpy = vi.fn();
    initStrategyBridgeMock.mockReturnValueOnce(makeBridge(disposeSpy));
    planMock.mockRejectedValueOnce(new Error("plan failed"));
    const state = makeState();

    await expect(
      runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), makeDeps()),
    ).rejects.toThrow("plan failed");

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(state.phases.act.status).toBe("failed");
  });

  it("runs hooks in beforeSense -> afterAct -> afterConfirm order and never calls publish-draft hooks", async () => {
    const calls: string[] = [];
    runBeforeSenseMock.mockImplementation(async () => { calls.push("beforeSense"); });
    runAfterActMock.mockImplementation(async () => { calls.push("afterAct"); });
    runAfterConfirmMock.mockImplementation(async () => { calls.push("afterConfirm"); });
    const state = makeState();

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), makeDeps());

    expect(calls).toEqual(["beforeSense", "afterAct", "afterConfirm"]);
    expect(beforePublishDraftMock).not.toHaveBeenCalled();
    expect(afterPublishDraftMock).not.toHaveBeenCalled();
  });

  it("connects the wallet before strategy bridge initialization", async () => {
    const order: string[] = [];
    const state = makeState();
    const deps = makeDeps({
      connectWallet: vi.fn().mockImplementation(async () => {
        order.push("wallet");
        return { demos: { kind: "demos" }, address: "demos1realwallet" };
      }),
    });
    initStrategyBridgeMock.mockImplementationOnce((_agent: string, _yaml: string, address: string) => {
      order.push("bridge");
      expect(address).toBe("demos1realwallet");
      return makeBridge();
    });

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), deps);

    expect(order).toEqual(["wallet", "bridge"]);
  });

  it("fails ACT when all publish actions fail", async () => {
    const state = makeState();
    planMock.mockResolvedValueOnce({
      actions: [{ type: "PUBLISH", target: null, reason: "test", evidence: [], metadata: { topics: ["test"] } }],
      decisions: [],
    });
    executePublishActionsMock.mockResolvedValueOnce({
      executed: [{ action: { type: "PUBLISH" }, success: false, error: "chain error" }],
      skipped: [],
    });

    await expect(
      runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), makeDeps()),
    ).rejects.toThrow("All 1 action(s) failed");

    expect(state.phases.act.status).toBe("failed");
  });

  it("resumes from act completed and only runs confirm", async () => {
    const state = makeState();
    state.phases.sense = { status: "completed", result: { scan: {}, strategy: {} } };
    state.phases.act = { status: "completed", result: { executed: [], skipped: [] } };
    state.strategyResults = { senseResult: {}, planResult: {}, executionResult: {} };
    state.posts = [{ txHash: "0xresume", category: "tech" }] as any;
    const deps = makeDeps();

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), deps);

    expect(senseMock).not.toHaveBeenCalled();
    expect(planMock).not.toHaveBeenCalled();
    expect(executePublishActionsMock).not.toHaveBeenCalled();
    expect(state.phases.confirm.status).toBe("completed");
    expect(deps.runSubprocess).toHaveBeenCalledWith(
      "cli/verify.ts",
      expect.arrayContaining(["0xresume"]),
      "verify",
    );
  });

  it("throws when sense was skipped and ACT requires real sense payload", async () => {
    const state = makeState();
    // Simulate --skip-to act scenario: sense marked completed but with skipped result
    state.phases.sense = { status: "completed", result: { skipped: true, reason: "--skip-to act" } };

    await expect(
      runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), makeDeps()),
    ).rejects.toThrow("Missing V3 sense result");

    expect(state.phases.act.status).toBe("failed");
  });

  it("ingestChainPostsIntoColonyDb inserts valid posts and skips invalid timestamps", async () => {
    // Setup: 3 valid posts + 1 with invalid timestamp
    const chainPosts = [
      { txHash: "0xp1", author: "a1", blockNumber: 100, timestamp: 1711843200000, text: "post1", tags: ["defi"], replyTo: null, category: "ANALYSIS", reactions: 0, reactionsKnown: true },
      { txHash: "0xp2", author: "a2", blockNumber: 101, timestamp: 1711843300000, text: "post2", tags: [], replyTo: null, category: "NEWS", reactions: 0, reactionsKnown: true },
      { txHash: "0xp3", author: "a3", blockNumber: 102, timestamp: 1711843400000, text: "post3", tags: ["ai"], replyTo: "0xp1", category: "ANALYSIS", reactions: 0, reactionsKnown: true },
      { txHash: "0xp4", author: "a4", blockNumber: 103, timestamp: "not-a-number", text: "post4", tags: [], replyTo: null, category: "SPAM", reactions: 0, reactionsKnown: true },
    ];

    createSdkBridgeMock.mockReturnValue({
      apiCall: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
      publishHivePost: vi.fn(),
      transferDem: vi.fn(),
      getHivePosts: vi.fn().mockResolvedValue(chainPosts),
    });

    // Phase 9: DataSource now provides posts instead of sdkBridge.getHivePosts
    dataSourceGetRecentPostsMock.mockResolvedValueOnce(chainPosts);

    // countPosts returns 0 before, 3 after to simulate 3 inserted
    countPostsMock.mockReturnValueOnce(0).mockReturnValueOnce(3);

    const state = makeState();
    const deps = makeDeps();

    // Only run sense phase (ingest happens during sense)
    planMock.mockResolvedValueOnce({ actions: [], log: {} });

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), deps);

    // 3 valid posts inserted, invalid one skipped
    expect(insertPostMock).toHaveBeenCalledTimes(3);
    // countPosts called for before and after counts
    expect(countPostsMock).toHaveBeenCalledTimes(2);
    // Warning emitted for invalid timestamp
    expect(deps.observe).toHaveBeenCalledWith(
      "warning",
      expect.stringContaining("0xp4"),
      expect.objectContaining({ source: "v3-loop:ingestChainPosts", txHash: "0xp4" }),
    );
    // Insight emitted for ingestion counts
    expect(deps.observe).toHaveBeenCalledWith(
      "insight",
      expect.stringContaining("ingested 3 new posts"),
      expect.objectContaining({ source: "v3-loop:ingestChainPosts", newPosts: 3 }),
    );
  });

  // Reaction refresh tests removed — reactions are API-only (chain scanning removed).
  // The v3-loop no longer calls getHiveReactions during sense phase.
  // API enrichment for reaction counts will be tested when wired in a follow-up.

  it("succeeds ACT when at least one action succeeds among failures", async () => {
    const state = makeState();
    planMock.mockResolvedValueOnce({
      actions: [
        { type: "PUBLISH", target: null, reason: "test", evidence: [], metadata: { topics: ["test"] } },
        { type: "ENGAGE", target: "tx1", reason: "agree", evidence: [], metadata: {} },
      ],
      decisions: [],
    });
    executeStrategyActionsMock.mockResolvedValueOnce({
      executed: [{ action: { type: "ENGAGE" }, success: true }],
      skipped: [],
    });
    executePublishActionsMock.mockResolvedValueOnce({
      executed: [{ action: { type: "PUBLISH" }, success: false, error: "chain error" }],
      skipped: [],
    });

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), makeDeps());

    expect(state.phases.act.status).toBe("completed");
  });
});
