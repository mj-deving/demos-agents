/**
 * Integration test: proof ingestion wiring in v3-loop SENSE phase.
 *
 * Verifies that ingestProofs() is called after ingestChainPostsIntoColonyDb()
 * during the SENSE phase, and that failures are non-fatal.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const ingestProofsMock = vi.fn().mockResolvedValue({ resolved: 0, verified: 0, failed: 0, skipped: 0 });
const createChainReaderFromSdkMock = vi.fn().mockReturnValue({ getTxByHash: vi.fn() });

// Must hoist mocks before any imports
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
  upsertSourceResponseMock,
  getSourceResponseMock,
  deriveIntentsFromTopicsMock,
  deriveIntentsFromSignalTopicsMock,
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
  getRecentPosts: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/toolkit/colony/reactions.js", () => ({
  upsertReaction: vi.fn(),
  getReaction: vi.fn().mockReturnValue(null),
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

vi.mock("../../src/toolkit/colony/intelligence.js", () => ({
  refreshAgentProfiles: vi.fn().mockReturnValue(0),
}));

vi.mock("../../src/toolkit/colony/proof-ingestion-rpc-adapter.js", () => ({
  createChainReaderFromSdk: createChainReaderFromSdkMock,
}));

vi.mock("../../src/toolkit/colony/proof-ingestion.js", () => ({
  ingestProofs: ingestProofsMock,
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
  class MockApiClient { getFeed = vi.fn().mockResolvedValue(null); listAgents = vi.fn().mockResolvedValue(null); getAgentLeaderboard = vi.fn().mockResolvedValue(null); getOracle = vi.fn().mockResolvedValue(null); getPrices = vi.fn().mockResolvedValue(null); getSignals = vi.fn().mockResolvedValue(null); getConvergence = vi.fn().mockResolvedValue(null); getReport = vi.fn().mockResolvedValue(null); lookupByChainAddress = vi.fn().mockResolvedValue(null); initiateTip = vi.fn().mockResolvedValue(null); }
  return { SuperColonyApiClient: MockApiClient };
});

vi.mock("../../src/toolkit/data-source.js", () => {
  const makeMockDS = (name: string) => class { name = name; getRecentPosts = vi.fn().mockResolvedValue([]); getPostByHash = vi.fn().mockResolvedValue(null); getThread = vi.fn().mockResolvedValue(null); getRepliesTo = vi.fn().mockResolvedValue([]); };
  return { ApiDataSource: makeMockDS("api"), ChainDataSource: makeMockDS("chain"), AutoDataSource: makeMockDS("auto") };
});

vi.mock("../../src/toolkit/primitives/index.js", () => ({
  createToolkit: vi.fn().mockReturnValue({
    feed: { getRecent: vi.fn().mockResolvedValue(null), search: vi.fn().mockResolvedValue(null), getPost: vi.fn().mockResolvedValue(null), getThread: vi.fn().mockResolvedValue(null) },
    intelligence: { getSignals: vi.fn().mockResolvedValue(null), getConvergence: vi.fn().mockResolvedValue(null), getReport: vi.fn().mockResolvedValue(null) },
    scores: { getLeaderboard: vi.fn().mockResolvedValue(null), getTopPosts: vi.fn().mockResolvedValue(null) },
    agents: { list: vi.fn().mockResolvedValue(null), getProfile: vi.fn().mockResolvedValue(null), getIdentities: vi.fn().mockResolvedValue(null) },
    actions: { tip: vi.fn().mockResolvedValue(null) },
    oracle: { get: vi.fn().mockResolvedValue(null) },
    prices: { get: vi.fn().mockResolvedValue(null), getHistory: vi.fn().mockResolvedValue(null) },
    verification: { verifyDahr: vi.fn().mockResolvedValue(null), verifyTlsn: vi.fn().mockResolvedValue(null), getTlsnProof: vi.fn().mockResolvedValue(null) },
    predictions: { query: vi.fn().mockResolvedValue(null), resolve: vi.fn().mockResolvedValue(null), markets: vi.fn().mockResolvedValue(null) },
    ballot: { getPool: vi.fn().mockResolvedValue(null), getHigherLowerPool: vi.fn().mockResolvedValue(null), getBinaryPools: vi.fn().mockResolvedValue(null) },
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

function makeBridge(disposeSpy = vi.fn()) {
  return {
    store: { kind: "store" },
    db: {
      kind: "db",
      pragma: vi.fn(),
      transaction: vi.fn((fn: (...args: any[]) => void) => fn),
      prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), run: vi.fn() }),
    },
    walletAddress: "demos1test",
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
    runSubprocess: vi.fn().mockResolvedValue({ activity: { level: "moderate" } }),
    connectWallet: vi.fn().mockResolvedValue({ demos: { kind: "demos" }, address: "demos1realwallet" }),
    resolveProvider: vi.fn().mockReturnValue({ kind: "provider" } as any),
    agentConfig: {
      name: "sentinel",
      loopExtensions: [],
      paths: {
        strategyYaml: "/tmp/strategy.yaml",
        improvementsFile: "/tmp/improvements.json",
      },
    } as any,
    getSourceView: vi.fn().mockReturnValue({
      all: [],
      byId: () => undefined,
      byProvider: () => [],
    }),
    observe: vi.fn(),
    ...overrides,
  };
}

describe("v3-loop proof ingestion wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const bridge = makeBridge();
    initStrategyBridgeMock.mockReturnValue(bridge);
    senseMock.mockReturnValue({ actions: [], signals: [] });
    planMock.mockResolvedValue({ actions: [] });
    computePerformanceMock.mockReturnValue({ scores: [] });

    createSdkBridgeMock.mockReturnValue({
      apiAccess: "none",
      getHivePosts: vi.fn().mockResolvedValue([]),
      apiCall: vi.fn().mockResolvedValue({ ok: false, status: 0, data: "" }),
    });

    ingestProofsMock.mockResolvedValue({ resolved: 0, verified: 0, failed: 0, skipped: 0 });
    createChainReaderFromSdkMock.mockReturnValue({ getTxByHash: vi.fn() });
  });

  it("calls ingestProofs during SENSE phase after chain post ingestion", async () => {
    const state = makeState();
    const deps = makeDeps();

    await runV3Loop(state, makeFlags(), "/tmp/sessions", {}, deps);

    expect(createChainReaderFromSdkMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "demos" }),
      { concurrency: 5 },
    );
    expect(ingestProofsMock).toHaveBeenCalledTimes(1);
  });

  it("logs insight when proofs are resolved or failed", async () => {
    ingestProofsMock.mockResolvedValue({ resolved: 3, verified: 3, failed: 1, skipped: 2 });

    const state = makeState();
    const deps = makeDeps();

    await runV3Loop(state, makeFlags(), "/tmp/sessions", {}, deps);

    expect(deps.observe).toHaveBeenCalledWith(
      "insight",
      expect.stringContaining("Proof ingestion:"),
      expect.objectContaining({ source: "v3-loop:proofIngestion" }),
    );
  });

  it("does not log when no proofs resolved or failed", async () => {
    ingestProofsMock.mockResolvedValue({ resolved: 0, verified: 0, failed: 0, skipped: 5 });

    const state = makeState();
    const deps = makeDeps();

    await runV3Loop(state, makeFlags(), "/tmp/sessions", {}, deps);

    const proofCalls = (deps.observe as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: any[]) => call[2]?.source === "v3-loop:proofIngestion",
    );
    expect(proofCalls).toHaveLength(0);
  });

  it("catches ingestProofs errors as non-fatal warnings", async () => {
    ingestProofsMock.mockRejectedValue(new Error("DB locked"));

    const state = makeState();
    const deps = makeDeps();

    // Should not throw
    await runV3Loop(state, makeFlags(), "/tmp/sessions", {}, deps);

    expect(deps.observe).toHaveBeenCalledWith(
      "warning",
      expect.stringContaining("Proof ingestion failed (non-fatal)"),
      expect.objectContaining({ source: "v3-loop:proofIngestion" }),
    );
  });
});
