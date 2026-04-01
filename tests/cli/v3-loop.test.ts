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
  selectSourcesByIntentMock,
  fetchSourceMock,
} = vi.hoisted(() => ({
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
  selectSourcesByIntentMock: vi.fn().mockReturnValue([]),
  fetchSourceMock: vi.fn().mockResolvedValue({ ok: false }),
}));

vi.mock("../../cli/v3-strategy-bridge.js", () => ({
  initStrategyBridge: initStrategyBridgeMock,
  sense: senseMock,
  plan: planMock,
  computePerformance: computePerformanceMock,
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
  selectSourcesByIntent: selectSourcesByIntentMock,
}));

vi.mock("../../src/toolkit/sources/fetch.js", () => ({
  fetchSource: fetchSourceMock,
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
      publishHiveReaction: vi.fn(),
      publishHivePost: vi.fn(),
      transferDem: vi.fn(),
      getHivePosts: vi.fn().mockResolvedValue([]),
      getHiveReactions: vi.fn().mockResolvedValue(new Map()),
    });
    executeStrategyActionsMock.mockResolvedValue({
      executed: [{ action: { type: "ENGAGE" }, success: true, txHash: "0xengage" }],
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
      publishHiveReaction: vi.fn(),
      publishHivePost: vi.fn(),
      transferDem: vi.fn(),
      getHivePosts: vi.fn().mockResolvedValue(chainPosts),
      getHiveReactions: vi.fn().mockResolvedValue(new Map()),
    });

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

  it("refreshes reaction cache for recent posts during sense phase", async () => {
    const recentPosts = [
      { txHash: "0xrecent1", author: "a1", blockNumber: 200, timestamp: new Date().toISOString(), replyTo: null, tags: [], text: "recent1", rawData: {} },
      { txHash: "0xrecent2", author: "a2", blockNumber: 201, timestamp: new Date().toISOString(), replyTo: null, tags: [], text: "recent2", rawData: {} },
    ];
    getRecentPostsMock.mockReturnValue(recentPosts);

    const reactionsMap = new Map([
      ["0xrecent1", { agree: 5, disagree: 1 }],
      ["0xrecent2", { agree: 2, disagree: 0 }],
    ]);
    const getHiveReactionsMock = vi.fn().mockResolvedValue(reactionsMap);
    createSdkBridgeMock.mockReturnValue({
      publishHiveReaction: vi.fn(),
      publishHivePost: vi.fn(),
      transferDem: vi.fn(),
      getHivePosts: vi.fn().mockResolvedValue([]),
      getHiveReactions: getHiveReactionsMock,
    });

    planMock.mockResolvedValueOnce({ actions: [], log: {} });
    const state = makeState();
    const deps = makeDeps();

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), deps);

    expect(getHiveReactionsMock).toHaveBeenCalledWith(["0xrecent1", "0xrecent2"]);
    expect(upsertReactionMock).toHaveBeenCalledTimes(2);
    expect(upsertReactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ postTxHash: "0xrecent1", agrees: 5, disagrees: 1 }),
    );
    expect(upsertReactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ postTxHash: "0xrecent2", agrees: 2, disagrees: 0 }),
    );
    expect(deps.observe).toHaveBeenCalledWith(
      "insight",
      expect.stringContaining("Reaction refresh: 2 posts updated"),
      expect.objectContaining({ source: "v3-loop:reactionRefresh", postsRefreshed: 2 }),
    );
  });

  it("preserves existing tip/reply metrics when refreshing agree/disagree counts", async () => {
    const recentPosts = [
      { txHash: "0xwithTips", author: "a1", blockNumber: 200, timestamp: new Date().toISOString(), replyTo: null, tags: [], text: "recent1", rawData: {} },
    ];
    getRecentPostsMock.mockReturnValue(recentPosts);

    // Existing row has tip data that must be preserved
    getReactionMock.mockReturnValue({
      postTxHash: "0xwithTips",
      agrees: 1,
      disagrees: 0,
      tipsCount: 3,
      tipsTotalDem: 15,
      replyCount: 2,
      lastUpdatedAt: "2026-03-31T00:00:00.000Z",
    });

    const reactionsMap = new Map([
      ["0xwithTips", { agree: 8, disagree: 2 }],
    ]);
    createSdkBridgeMock.mockReturnValue({
      publishHiveReaction: vi.fn(),
      publishHivePost: vi.fn(),
      transferDem: vi.fn(),
      getHivePosts: vi.fn().mockResolvedValue([]),
      getHiveReactions: vi.fn().mockResolvedValue(reactionsMap),
    });

    planMock.mockResolvedValueOnce({ actions: [], log: {} });
    const state = makeState();

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), makeDeps());

    // agree/disagree updated, tip/reply preserved from existing row
    expect(upsertReactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        postTxHash: "0xwithTips",
        agrees: 8,
        disagrees: 2,
        tipsCount: 3,
        tipsTotalDem: 15,
        replyCount: 2,
      }),
    );
  });

  it("skips reaction refresh when no recent posts exist", async () => {
    getRecentPostsMock.mockReturnValue([]);
    const getHiveReactionsMock = vi.fn();
    createSdkBridgeMock.mockReturnValue({
      publishHiveReaction: vi.fn(),
      publishHivePost: vi.fn(),
      transferDem: vi.fn(),
      getHivePosts: vi.fn().mockResolvedValue([]),
      getHiveReactions: getHiveReactionsMock,
    });

    planMock.mockResolvedValueOnce({ actions: [], log: {} });
    const state = makeState();

    await runV3Loop(state, makeFlags(), mkdtempSync(join(tmpdir(), "v3-loop-")), new Map(), makeDeps());

    expect(getHiveReactionsMock).not.toHaveBeenCalled();
    expect(upsertReactionMock).not.toHaveBeenCalled();
  });

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
