/**
 * Tests for agent-loop.ts — generic observe-decide-act-sleep loop.
 *
 * Validates:
 * - observe() called each iteration
 * - decideActions() receives correct ColonyState shape
 * - Light actions (ENGAGE + TIP) delegate to injected executor
 * - Heavy actions (PUBLISH + REPLY) delegate to injected executor
 * - SIGINT stops the loop gracefully
 * - maxIterations respected
 * - Rate-limit carryover: postsToday increments across iterations, resets on day boundary
 * - NULL SAFETY: ApiResult checks use optional chaining
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ColonyState } from "../../src/toolkit/colony/state-extraction.js";
import type { StrategyAction } from "../../src/toolkit/strategy/types.js";

// ── Hoisted mocks ────────────────────────────────

const {
  mockDecideActions,
  mockLoadStrategyConfig,
} = vi.hoisted(() => ({
  mockDecideActions: vi.fn().mockReturnValue({ actions: [], log: { considered: [], rejected: [] } }),
  mockLoadStrategyConfig: vi.fn().mockReturnValue({
    rules: [],
    rateLimits: { postsPerDay: 10, postsPerHour: 3, reactionsPerSession: 5, maxTipAmount: 5 },
    performance: {},
    topicWeights: {},
    enrichment: {},
  }),
}));

vi.mock("../../src/toolkit/strategy/engine.js", () => ({
  decideActions: mockDecideActions,
}));

vi.mock("../../src/toolkit/strategy/config-loader.js", () => ({
  loadStrategyConfig: mockLoadStrategyConfig,
}));

// Mock fs.readFileSync for strategy YAML loading
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue("apiVersion: strategy/v3\nrules: []"),
  };
});

import { runAgentLoop, defaultObserve } from "../../src/toolkit/agent-loop.js";
import type { ObserveFn, ObserveResult, AgentLoopOptions, LightExecutor, HeavyExecutor } from "../../src/toolkit/agent-loop.js";
import type { AgentRuntime } from "../../src/toolkit/agent-runtime.js";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";

// ── Helpers ──────────────────────────────────────

function makeColonyState(overrides?: Partial<ColonyState>): ColonyState {
  return {
    activity: { postsPerHour: 5, activeAuthors: 3, trendingTopics: [{ topic: "DeFi", count: 10 }] },
    gaps: { underservedTopics: [], unansweredQuestions: [], staleThreads: [] },
    threads: { activeDiscussions: [], mentionsOfUs: [] },
    agents: { topContributors: [{ author: "0xA", postCount: 5, avgReactions: 3 }] },
    ...overrides,
  };
}

function makeObserveResult(overrides?: Partial<ObserveResult>): ObserveResult {
  return {
    colonyState: makeColonyState(),
    evidence: [],
    ...overrides,
  };
}

function makeMockRuntime(overrides?: Partial<AgentRuntime>): AgentRuntime {
  return {
    toolkit: makeMockToolkit(),
    sdkBridge: {
      apiCall: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
      publishHivePost: vi.fn().mockResolvedValue({ txHash: "0xpub" }),
      transferDem: vi.fn().mockResolvedValue({ txHash: "0xtip" }),
    } as any,
    address: "0xTestAddress",
    getToken: vi.fn().mockResolvedValue("test-token"),
    demos: {} as any,
    authenticatedApiCall: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
    llmProvider: null,
    ...overrides,
  };
}

function makeMockToolkit(): Toolkit {
  const noopFn = vi.fn().mockResolvedValue(null);
  return {
    feed: { getRecent: noopFn, search: noopFn, getPost: noopFn, getThread: noopFn },
    intelligence: { getSignals: noopFn, getReport: noopFn },
    scores: { getLeaderboard: noopFn },
    agents: { list: noopFn, getProfile: noopFn, getIdentities: noopFn },
    actions: { tip: noopFn, react: noopFn, getReactions: noopFn, getTipStats: noopFn, getAgentTipStats: noopFn, placeBet: noopFn },
    oracle: { get: noopFn },
    prices: { get: noopFn },
    verification: { verifyDahr: noopFn, verifyTlsn: noopFn },
    predictions: { query: noopFn, resolve: noopFn, markets: noopFn },
    ballot: { getState: noopFn, getAccuracy: noopFn, getLeaderboard: noopFn, getPerformance: noopFn, getPool: noopFn },
    webhooks: { list: noopFn, create: noopFn, delete: noopFn },
    identity: { lookup: noopFn },
    balance: { get: noopFn },
    health: { check: noopFn },
    stats: { get: noopFn },
  } as unknown as Toolkit;
}

const mockLightExecutor: LightExecutor = vi.fn().mockResolvedValue({ executed: [], skipped: [] });
const mockHeavyExecutor: HeavyExecutor = vi.fn().mockResolvedValue({ executed: [], skipped: [] });

function makeLoopOpts(overrides?: Partial<AgentLoopOptions>): AgentLoopOptions {
  return {
    strategyPath: "/tmp/test-strategy.yaml",
    maxIterations: 1,
    intervalMs: 0, // no sleep in tests
    executeLightActions: mockLightExecutor,
    executeHeavyActions: mockHeavyExecutor,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────

describe("runAgentLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecideActions.mockReturnValue({ actions: [], log: { considered: [], rejected: [] } });
    (mockLightExecutor as any).mockResolvedValue({ executed: [], skipped: [] });
    (mockHeavyExecutor as any).mockResolvedValue({ executed: [], skipped: [] });
  });

  it("calls observe() on each iteration", async () => {
    const runtime = makeMockRuntime();
    const observe = vi.fn().mockResolvedValue(makeObserveResult());

    await runAgentLoop(runtime, observe, makeLoopOpts({ maxIterations: 3 }));
    expect(observe).toHaveBeenCalledTimes(3);
    expect(observe).toHaveBeenCalledWith(runtime.toolkit, runtime.address);
  });

  it("passes ColonyState with correct shape to decideActions", async () => {
    const runtime = makeMockRuntime();
    const colonyState = makeColonyState();
    const observe = vi.fn().mockResolvedValue(makeObserveResult({ colonyState }));

    await runAgentLoop(runtime, observe, makeLoopOpts());

    expect(mockDecideActions).toHaveBeenCalledTimes(1);
    const [passedState] = mockDecideActions.mock.calls[0];
    expect(passedState).toHaveProperty("activity");
    expect(passedState).toHaveProperty("gaps");
    expect(passedState).toHaveProperty("threads");
    expect(passedState).toHaveProperty("agents");
    expect(passedState.activity.trendingTopics).toEqual([{ topic: "DeFi", count: 10 }]);
  });

  it("respects maxIterations", async () => {
    const runtime = makeMockRuntime();
    const observe = vi.fn().mockResolvedValue(makeObserveResult());

    await runAgentLoop(runtime, observe, makeLoopOpts({ maxIterations: 5 }));
    expect(observe).toHaveBeenCalledTimes(5);
  });

  describe("light path (ENGAGE + TIP)", () => {
    it("delegates ENGAGE actions to injected light executor", async () => {
      const engageAction: StrategyAction = { type: "ENGAGE", priority: 50, target: "0xtx1", reason: "verified" };
      mockDecideActions.mockReturnValue({ actions: [engageAction], log: { considered: [], rejected: [] } });
      (mockLightExecutor as any).mockResolvedValue({
        executed: [{ action: engageAction, success: true }],
        skipped: [],
      });

      const runtime = makeMockRuntime();
      await runAgentLoop(runtime, vi.fn().mockResolvedValue(makeObserveResult()), makeLoopOpts());

      expect(mockLightExecutor).toHaveBeenCalledTimes(1);
      const [actions, rt] = (mockLightExecutor as any).mock.calls[0];
      expect(actions).toEqual([engageAction]);
      expect(rt).toBe(runtime);
    });

    it("delegates TIP actions to light executor", async () => {
      const tipAction: StrategyAction = { type: "TIP", priority: 30, target: "0xtx2", reason: "valuable" };
      mockDecideActions.mockReturnValue({ actions: [tipAction], log: { considered: [], rejected: [] } });
      (mockLightExecutor as any).mockResolvedValue({
        executed: [{ action: tipAction, success: true }],
        skipped: [],
      });

      const runtime = makeMockRuntime();
      await runAgentLoop(runtime, vi.fn().mockResolvedValue(makeObserveResult()), makeLoopOpts());

      expect(mockLightExecutor).toHaveBeenCalledTimes(1);
    });

    it("counts only ENGAGE as reactions, not TIP", async () => {
      const actions: StrategyAction[] = [
        { type: "ENGAGE", priority: 50, target: "0x1", reason: "test" },
        { type: "TIP", priority: 30, target: "0x2", reason: "test" },
        { type: "ENGAGE", priority: 50, target: "0x3", reason: "test" },
      ];
      mockDecideActions.mockReturnValue({ actions, log: { considered: [], rejected: [] } });
      (mockLightExecutor as any).mockResolvedValue({
        executed: actions.map(a => ({ action: a, success: true })),
        skipped: [],
      });

      const runtime = makeMockRuntime();
      let iteration = 0;
      mockDecideActions.mockImplementation((_cs: any, _ev: any, _cfg: any, ctx: any) => {
        iteration++;
        if (iteration === 2) {
          // On second iteration, reactionsUsed should be 2 (from 2 ENGAGEs)
          expect(ctx.sessionReactionsUsed).toBe(2);
        }
        return { actions: iteration === 1 ? actions : [], log: { considered: [], rejected: [] } };
      });

      await runAgentLoop(runtime, vi.fn().mockResolvedValue(makeObserveResult()), makeLoopOpts({ maxIterations: 2 }));
    });
  });

  describe("heavy path (PUBLISH + REPLY + VOTE + BET)", () => {
    it("delegates PUBLISH actions to injected heavy executor", async () => {
      const publishAction: StrategyAction = { type: "PUBLISH", priority: 80, reason: "fresh evidence" };
      mockDecideActions.mockReturnValue({ actions: [publishAction], log: { considered: [], rejected: [] } });
      (mockHeavyExecutor as any).mockResolvedValue({ executed: [], skipped: [] });

      const runtime = makeMockRuntime();
      const opts = makeLoopOpts();
      await runAgentLoop(runtime, vi.fn().mockResolvedValue(makeObserveResult()), opts);

      expect(mockHeavyExecutor).toHaveBeenCalledTimes(1);
      const [actions, rt] = (mockHeavyExecutor as any).mock.calls[0];
      expect(actions).toEqual([publishAction]);
      expect(rt).toBe(runtime);
    });

    it("delegates REPLY actions to heavy path", async () => {
      const replyAction: StrategyAction = { type: "REPLY", priority: 60, target: "0xroot", reason: "mention" };
      mockDecideActions.mockReturnValue({ actions: [replyAction], log: { considered: [], rejected: [] } });
      (mockHeavyExecutor as any).mockResolvedValue({ executed: [], skipped: [] });

      const runtime = makeMockRuntime();
      await runAgentLoop(runtime, vi.fn().mockResolvedValue(makeObserveResult()), makeLoopOpts());

      expect(mockHeavyExecutor).toHaveBeenCalledTimes(1);
    });

    it("increments postsToday from heavy path results", async () => {
      const publishAction: StrategyAction = { type: "PUBLISH", priority: 80, reason: "evidence" };
      (mockHeavyExecutor as any).mockResolvedValue({
        executed: [{ action: publishAction, success: true, txHash: "0xpub1", category: "ANALYSIS" }],
        skipped: [],
      });

      let iteration = 0;
      mockDecideActions.mockImplementation((_cs: any, _ev: any, _cfg: any, ctx: any) => {
        iteration++;
        if (iteration === 2) {
          expect(ctx.postsToday).toBe(1);
          expect(ctx.postsThisHour).toBe(1);
        }
        return { actions: iteration === 1 ? [publishAction] : [], log: { considered: [], rejected: [] } };
      });

      const runtime = makeMockRuntime();
      await runAgentLoop(runtime, vi.fn().mockResolvedValue(makeObserveResult()), makeLoopOpts({ maxIterations: 2 }));
    });
  });

  describe("action splitting", () => {
    it("splits mixed actions into light and heavy paths", async () => {
      const mixedActions: StrategyAction[] = [
        { type: "ENGAGE", priority: 65, target: "0x1", reason: "verified" },
        { type: "PUBLISH", priority: 80, reason: "evidence" },
        { type: "TIP", priority: 30, target: "0x2", reason: "valuable" },
        { type: "VOTE", priority: 40, target: "0x3", reason: "consensus" },
      ];
      mockDecideActions.mockReturnValue({ actions: mixedActions, log: { considered: [], rejected: [] } });
      (mockLightExecutor as any).mockResolvedValue({ executed: [], skipped: [] });
      (mockHeavyExecutor as any).mockResolvedValue({ executed: [], skipped: [] });

      const runtime = makeMockRuntime();
      await runAgentLoop(runtime, vi.fn().mockResolvedValue(makeObserveResult()), makeLoopOpts());

      // Light: ENGAGE + TIP
      const [lightActions] = (mockLightExecutor as any).mock.calls[0];
      expect(lightActions).toHaveLength(2);
      expect(lightActions.map((a: any) => a.type)).toEqual(["ENGAGE", "TIP"]);

      // Heavy: PUBLISH + VOTE
      const [heavyActions] = (mockHeavyExecutor as any).mock.calls[0];
      expect(heavyActions).toHaveLength(2);
      expect(heavyActions.map((a: any) => a.type)).toEqual(["PUBLISH", "VOTE"]);
    });
  });

  describe("rate-limit tracking", () => {
    it("passes DecisionContext with rate-limit counters", async () => {
      const runtime = makeMockRuntime();
      await runAgentLoop(runtime, vi.fn().mockResolvedValue(makeObserveResult()), makeLoopOpts());

      const [, , , ctx] = mockDecideActions.mock.calls[0];
      expect(ctx.ourAddress).toBe("0xTestAddress");
      expect(ctx.sessionReactionsUsed).toBe(0);
      expect(ctx.postsToday).toBe(0);
      expect(ctx.postsThisHour).toBe(0);
    });

    it("merges observed context into DecisionContext", async () => {
      const observeResult = makeObserveResult({
        context: { apiEnrichment: { agentCount: 42 } } as any,
      });

      const runtime = makeMockRuntime();
      await runAgentLoop(runtime, vi.fn().mockResolvedValue(observeResult), makeLoopOpts());

      const [, , , ctx] = mockDecideActions.mock.calls[0];
      expect(ctx.apiEnrichment).toEqual({ agentCount: 42 });
    });
  });

  describe("error handling", () => {
    it("calls onError when observe throws", async () => {
      const observeError = new Error("observe failed");
      const observe = vi.fn().mockRejectedValue(observeError);
      const onError = vi.fn();

      const runtime = makeMockRuntime();
      await runAgentLoop(runtime, observe, makeLoopOpts({ onError }));

      expect(onError).toHaveBeenCalledWith(observeError);
    });

    it("calls onAction for each executed light action", async () => {
      const action: StrategyAction = { type: "ENGAGE", priority: 50, target: "0x1", reason: "test" };
      mockDecideActions.mockReturnValue({ actions: [action], log: { considered: [], rejected: [] } });
      (mockLightExecutor as any).mockResolvedValue({
        executed: [{ action, success: true }],
        skipped: [],
      });

      const onAction = vi.fn();
      const runtime = makeMockRuntime();
      await runAgentLoop(runtime, vi.fn().mockResolvedValue(makeObserveResult()), makeLoopOpts({ onAction }));

      expect(onAction).toHaveBeenCalled();
    });
  });

  describe("SIGINT handling", () => {
    it("stops the loop when SIGINT is received", async () => {
      const runtime = makeMockRuntime();
      const observe = vi.fn().mockImplementation(async () => {
        process.emit("SIGINT" as any);
        return makeObserveResult();
      });

      await runAgentLoop(runtime, observe, makeLoopOpts({ maxIterations: 100 }));
      expect(observe.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });
});

describe("defaultObserve", () => {
  it("returns ObserveResult with colonyState and empty evidence", async () => {
    const toolkit = makeMockToolkit();
    (toolkit.feed.getRecent as any).mockResolvedValue({
      ok: true,
      data: { posts: [] },
    });

    const result = await defaultObserve(toolkit, "0xTestAddr");
    expect(result.colonyState).toBeDefined();
    expect(result.evidence).toEqual([]);
  });

  it("handles null ApiResult gracefully (optional chaining)", async () => {
    const toolkit = makeMockToolkit();
    (toolkit.feed.getRecent as any).mockResolvedValue(null);

    const result = await defaultObserve(toolkit, "0xTestAddr");
    expect(result.colonyState).toBeDefined();
    expect(result.colonyState.activity.postsPerHour).toBe(0);
  });
});
