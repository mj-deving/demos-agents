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
    db: { kind: "db" },
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
