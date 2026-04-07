import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StrategyAction } from "../../cli/v3-strategy-bridge.js";
import type { PublishExecutorDeps } from "../../cli/publish-executor.js";
import type { V3SessionState } from "../../src/lib/state.js";
import type { AgentSourceView, SourceRecordV2 } from "../../src/lib/sources/catalog.js";
import type { ProviderAdapter } from "../../src/lib/sources/providers/types.js";

const {
  generatePostMock,
  executeAttestationPlanMock,
  attestDahrMock,
  attestTlsnMock,
  publishPostMock,
  extractStructuredClaimsAutoMock,
  buildAttestationPlanMock,
  verifyAttestedValuesMock,
  resolveAttestationPlanMock,
  fetchSourceMock,
  preflightMock,
  selectSourceForTopicV2Mock,
  matchMock,
  getPostMock,
  checkAndRecordWriteMock,
  getWriteRateRemainingMock,
  createSdkBridgeMock,
  checkSessionBudgetMock,
  recordSpendMock,
  saveSpendingLedgerMock,
} = vi.hoisted(() => ({
  generatePostMock: vi.fn(),
  executeAttestationPlanMock: vi.fn(),
  attestDahrMock: vi.fn(),
  attestTlsnMock: vi.fn(),
  publishPostMock: vi.fn(),
  extractStructuredClaimsAutoMock: vi.fn(),
  buildAttestationPlanMock: vi.fn(),
  verifyAttestedValuesMock: vi.fn(),
  resolveAttestationPlanMock: vi.fn(),
  fetchSourceMock: vi.fn(),
  preflightMock: vi.fn(),
  selectSourceForTopicV2Mock: vi.fn(),
  matchMock: vi.fn(),
  getPostMock: vi.fn(),
  checkAndRecordWriteMock: vi.fn(),
  getWriteRateRemainingMock: vi.fn(),
  createSdkBridgeMock: vi.fn(),
  checkSessionBudgetMock: vi.fn(),
  recordSpendMock: vi.fn(),
  saveSpendingLedgerMock: vi.fn(),
}));

vi.mock("../../src/actions/llm.js", () => ({
  generatePost: generatePostMock,
}));

vi.mock("../../src/actions/attestation-executor.js", () => ({
  executeAttestationPlan: executeAttestationPlanMock,
}));

vi.mock("../../src/actions/publish-pipeline.js", () => ({
  attestDahr: attestDahrMock,
  attestTlsn: attestTlsnMock,
  publishPost: publishPostMock,
}));

vi.mock("../../src/lib/attestation/claim-extraction.js", () => ({
  extractStructuredClaimsAuto: extractStructuredClaimsAutoMock,
}));

vi.mock("../../src/lib/attestation/attestation-planner.js", () => ({
  buildAttestationPlan: buildAttestationPlanMock,
  verifyAttestedValues: verifyAttestedValuesMock,
}));

vi.mock("../../src/lib/attestation/attestation-policy.js", () => ({
  resolveAttestationPlan: resolveAttestationPlanMock,
}));

vi.mock("../../src/lib/sources/fetch.js", () => ({
  fetchSource: fetchSourceMock,
}));

vi.mock("../../src/lib/sources/policy.js", () => ({
  preflight: preflightMock,
  selectSourceForTopicV2: selectSourceForTopicV2Mock,
}));

vi.mock("../../src/lib/sources/matcher.js", () => ({
  match: matchMock,
}));

vi.mock("../../src/toolkit/colony/posts.js", () => ({
  getPost: getPostMock,
}));

vi.mock("../../src/toolkit/guards/write-rate-limit.js", () => ({
  checkAndRecordWrite: checkAndRecordWriteMock,
  getWriteRateRemaining: getWriteRateRemainingMock,
  rollbackWriteRecord: vi.fn(),
}));

vi.mock("../../src/toolkit/sdk-bridge.js", () => ({
  createSdkBridge: createSdkBridgeMock,
  AUTH_PENDING_TOKEN: "AUTH_PENDING",
}));

vi.mock("../../src/lib/spending-policy.js", () => ({
  checkSessionBudget: checkSessionBudgetMock,
  recordSpend: recordSpendMock,
  saveSpendingLedger: saveSpendingLedgerMock,
}));

import { executePublishActions } from "../../cli/publish-executor.js";

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "btc-source",
    name: "BTC Source",
    provider: "market",
    url: "https://source.test/data",
    urlPattern: "https://source.test/data",
    topics: ["bitcoin"],
    tlsn_safe: true,
    dahr_safe: true,
    max_response_kb: 8,
    topicAliases: ["btc"],
    domainTags: ["bitcoin", "price"],
    responseFormat: "json",
    scope: {
      visibility: "global",
      importedFrom: ["sentinel"],
    },
    runtime: {
      timeoutMs: 1000,
      retry: {
        maxAttempts: 1,
        backoffMs: 10,
        retryOn: [],
      },
    },
    adapter: { operation: "price" },
    trustTier: "official",
    status: "active",
    rating: {
      overall: 90,
      uptime: 90,
      relevance: 90,
      freshness: 90,
      sizeStability: 90,
      engagement: 90,
      trust: 90,
      testCount: 1,
      successCount: 1,
      consecutiveFailures: 0,
    },
    lifecycle: {
      discoveredAt: "2026-03-01T00:00:00.000Z",
      discoveredBy: "manual",
    },
    ...overrides,
  };
}

function makeSourceView(source: SourceRecordV2): AgentSourceView {
  return {
    agent: "sentinel",
    catalogVersion: 2,
    sources: [source],
    index: {
      byId: new Map([[source.id, source]]),
      byTopicToken: new Map(),
      byDomainTag: new Map(),
      byProvider: new Map(),
      byAgent: new Map(),
      byMethod: { TLSN: new Set([source.id]), DAHR: new Set([source.id]) },
    },
  };
}

function makeState(): V3SessionState {
  return {
    loopVersion: 3,
    sessionNumber: 7,
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

function makeAction(overrides: Partial<StrategyAction> = {}): StrategyAction {
  return {
    type: "PUBLISH",
    priority: 100,
    reason: "Share market update",
    metadata: { topics: ["bitcoin"] },
    ...overrides,
  };
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    text:
      "Bitcoin is trading at $64,231 with ETF net inflows of $1.2B this week, and the spread between spot and futures continues to compress as institutional demand stabilizes across the major venues. Funding has cooled while spot demand remains firm, which keeps the setup verifiable and materially different from the last rotation.",
    category: "ANALYSIS",
    tags: ["bitcoin", "etf"],
    confidence: 84,
    hypothesis: "ETF demand remains persistent",
    predicted_reactions: 21,
    ...overrides,
  };
}

function makeAdapter(source: SourceRecordV2): ProviderAdapter {
  return {
    provider: source.provider,
    domains: ["source.test"],
    rateLimit: { bucket: source.provider, maxPerMinute: 10, maxPerDay: 100 },
    supports: vi.fn().mockImplementation((candidate) => candidate.id === source.id),
    buildCandidates: vi.fn().mockReturnValue([]),
    validateCandidate: vi.fn().mockReturnValue({ ok: true }),
    parseResponse: vi.fn().mockReturnValue({
      entries: [
        {
          id: "entry-1",
          title: "BTC hits $64,231",
          summary: "ETF inflows accelerate",
          bodyText: "Bitcoin reached $64,231 as ETF inflows hit $1.2B.",
          topics: ["bitcoin"],
          metrics: { price: 64231, inflows: "1.2B" },
          raw: {},
        },
      ],
      normalized: { price: 64231 },
    }),
  };
}

function configureSuccessMocks(source: SourceRecordV2, url: string = source.url): void {
  const candidate = {
    sourceId: source.id,
    source,
    method: "DAHR" as const,
    url,
    score: 88,
  };

  resolveAttestationPlanMock.mockReturnValue({
    required: "DAHR",
    fallback: null,
    sensitive: false,
    reason: "test policy",
  });
  selectSourceForTopicV2Mock.mockReturnValue({
    source,
    url,
    score: 88,
  });
  fetchSourceMock.mockResolvedValue({
    ok: true,
    response: {
      url,
      status: 200,
      headers: {},
      bodyText: '{"price":64231}',
    },
    attempts: 1,
    totalMs: 5,
  });
  generatePostMock.mockResolvedValue(makeDraft());
  preflightMock.mockReturnValue({
    pass: true,
    reason: "DAHR source available",
    reasonCode: "PASS",
    candidates: [candidate],
    plan: { required: "DAHR", fallback: null, sensitive: false, reason: "test policy" },
  });
  matchMock.mockResolvedValue({
    pass: true,
    reason: "matched",
    reasonCode: "PASS",
    best: {
      sourceId: source.id,
      method: "DAHR",
      url,
      score: 91,
      matchedClaims: ["bitcoin", "$64,231"],
      evidence: ["1 title match"],
    },
    considered: [{ sourceId: source.id, score: 91 }],
  });
  extractStructuredClaimsAutoMock.mockResolvedValue([
    { text: "Bitcoin at $64,231", type: "price", entities: ["bitcoin", "BTC"], value: 64231, unit: "USD" },
  ]);
  buildAttestationPlanMock.mockReturnValue({
    primary: {
      claim: { text: "Bitcoin at $64,231", type: "price", entities: ["bitcoin", "BTC"], value: 64231, unit: "USD" },
      url,
      estimatedSizeBytes: 512,
      method: "GET",
      extractionPath: "$.price",
      provider: source.provider,
      rateLimitBucket: source.provider,
      plannedMethod: "DAHR",
    },
    secondary: [],
    fallbacks: [],
    unattested: [],
    estimatedCost: 1,
    budget: {
      maxCostPerPost: 15,
      maxTlsnPerPost: 1,
      maxDahrPerPost: 3,
      maxAttestationsPerPost: 4,
    },
  });
  executeAttestationPlanMock.mockResolvedValue({
    results: [
      {
        type: "dahr",
        url,
        requestedUrl: url,
        responseHash: "0xclaim-hash",
        txHash: "0xclaim-attestation",
        data: { price: 64231 },
      },
    ],
    skipped: [],
    failed: [],
  });
  verifyAttestedValuesMock.mockReturnValue([
    {
      claim: { text: "Bitcoin at $64,231", type: "price", entities: ["bitcoin", "BTC"], value: 64231, unit: "USD" },
      attestedValue: 64231,
      expectedValue: 64231,
      verified: true,
    },
  ]);
  attestDahrMock.mockResolvedValue({
    type: "dahr",
    url,
    requestedUrl: url,
    responseHash: "0xfallback-hash",
    txHash: "0xfallback-attestation",
    data: { price: 64231 },
  });
  attestTlsnMock.mockResolvedValue({
    type: "tlsn",
    url,
    requestedUrl: url,
    txHash: "0xtlsn-attestation",
    data: { price: 64231 },
  });
  publishPostMock.mockResolvedValue({
    txHash: "0xpublish",
    category: "ANALYSIS",
    textLength: 285,
  });
}

function createDeps(overrides: Partial<PublishExecutorDeps> = {}): PublishExecutorDeps {
  const source = makeSource();
  return {
    demos: {} as any,
    walletAddress: "demos1sentinel",
    provider: { name: "test-llm", complete: vi.fn() } as any,
    agentConfig: {
      name: "sentinel",
      paths: {
        personaMd: "/tmp/persona.md",
        strategyYaml: "/tmp/strategy.yaml",
      },
      gate: {
        predictedReactionsThreshold: 10,
      },
      attestation: {
        defaultMode: "dahr_only",
        highSensitivityRequireTlsn: false,
        highSensitivityKeywords: [],
      },
    } as any,
    sourceView: makeSourceView(source),
    state: makeState(),
    sessionsDir: "/tmp/sessions",
    observe: vi.fn(),
    dryRun: false,
    stateStore: {} as any,
    colonyDb: undefined,
    calibrationOffset: 0.25,
    scanContext: { activity_level: "moderate", posts_per_hour: 12, gaps: ["bitcoin"] },
    adapters: new Map([[source.provider, makeAdapter(source)]]),
    usageTracker: { usageCount: new Map(), providersUsed: new Set() },
    logSession: vi.fn(),
    logQuality: vi.fn(),
    ...overrides,
  };
}

describe("executePublishActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAndRecordWriteMock.mockResolvedValue({ error: null, recordedTimestamp: Date.now() });
    getWriteRateRemainingMock.mockResolvedValue({ dailyRemaining: 14, hourlyRemaining: 5 });
    getPostMock.mockReturnValue(null);
    createSdkBridgeMock.mockReturnValue({
      publishHivePost: vi.fn().mockResolvedValue({ txHash: "0xbet-publish" }),
    });
    checkSessionBudgetMock.mockReturnValue({ allowed: true, reason: "Within session budget", dryRun: false });
    const source = makeSource();
    configureSuccessMocks(source);
  });

  it("runs the PUBLISH pipeline end-to-end and updates state", async () => {
    const source = makeSource();
    const deps = createDeps({ sourceView: makeSourceView(source), adapters: new Map([[source.provider, makeAdapter(source)]]) });
    const action = makeAction({ evidence: [source.id] });

    const result = await executePublishActions([action], deps);

    expect(fetchSourceMock).toHaveBeenCalledWith(source.url, source, expect.any(Object));
    expect(generatePostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "bitcoin",
        calibrationOffset: 0.25,
        attestedData: expect.objectContaining({
          source: source.name,
          url: source.url,
        }),
      }),
      deps.provider,
      expect.any(Object),
    );
    expect(extractStructuredClaimsAutoMock).toHaveBeenCalled();
    expect(executeAttestationPlanMock).toHaveBeenCalled();
    expect(publishPostMock).toHaveBeenCalledOnce();
    expect(result.executed).toEqual([
      expect.objectContaining({
        action,
        success: true,
        txHash: "0xpublish",
        attestationType: "DAHR",
      }),
    ]);
    expect(deps.state.posts).toEqual([
      expect.objectContaining({
        txHash: "0xpublish",
        category: "ANALYSIS",
        attestationType: "DAHR",
        topic: "bitcoin",
      }),
    ]);
    expect(deps.state.publishedPosts).toEqual([
      expect.objectContaining({
        txHash: "0xpublish",
        topic: "bitcoin",
        replyTo: undefined,
        attestationType: "DAHR",
      }),
    ]);
    expect(deps.logSession).toHaveBeenCalledOnce();
    expect(deps.logQuality).toHaveBeenCalledOnce();
  });

  it("uses reply context from colonyDb for REPLY actions", async () => {
    const source = makeSource();
    const deps = createDeps({
      colonyDb: {} as any,
      sourceView: makeSourceView(source),
      adapters: new Map([[source.provider, makeAdapter(source)]]),
    });
    const action = makeAction({
      type: "REPLY",
      target: "0xparent",
      reason: "Respond with sourced context",
      metadata: { topics: ["governance"], author: "bob" },
      evidence: [source.id],
    });
    getPostMock.mockReturnValue({
      txHash: "0xparent",
      author: "alice",
      text: "Parent post about governance drift",
    });
    generatePostMock.mockResolvedValue(makeDraft({ replyTo: "0xparent" }));

    await executePublishActions([action], deps);

    expect(getPostMock).toHaveBeenCalledWith(deps.colonyDb, "0xparent");
    expect(generatePostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: {
          txHash: "0xparent",
          author: "alice",
          text: "Parent post about governance drift",
        },
      }),
      deps.provider,
      expect.any(Object),
    );
    expect(deps.state.publishedPosts?.[0]).toEqual(
      expect.objectContaining({
        replyTo: "0xparent",
      }),
    );
  });

  it("skips rate-limited actions with the guard reason", async () => {
    const deps = createDeps();
    const action = makeAction();
    checkAndRecordWriteMock.mockResolvedValue({
      error: {
        code: "RATE_LIMITED",
        message: "Hourly write limit reached (5/hour)",
      },
      recordedTimestamp: null,
    });
    getWriteRateRemainingMock.mockResolvedValue({ dailyRemaining: 9, hourlyRemaining: 0 });

    const result = await executePublishActions([action], deps);

    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([
      {
        action,
        reason: "Hourly write limit reached (5/hour) (dailyRemaining=9, hourlyRemaining=0)",
      },
    ]);
    expect(generatePostMock).not.toHaveBeenCalled();
    expect(publishPostMock).not.toHaveBeenCalled();
  });

  it("falls back from evidence lookup to catalog selection", async () => {
    const source = makeSource();
    const catalogUrl = "https://catalog.test/bitcoin";
    configureSuccessMocks(source, catalogUrl);
    const deps = createDeps({
      sourceView: makeSourceView(source),
      adapters: new Map([[source.provider, makeAdapter(source)]]),
    });
    const action = makeAction({
      evidence: ["missing-source"],
      metadata: { topics: ["bitcoin"] },
    });

    await executePublishActions([action], deps);

    expect(selectSourceForTopicV2Mock).toHaveBeenCalled();
    expect(fetchSourceMock).toHaveBeenCalledWith(catalogUrl, source, expect.any(Object));
  });

  it("falls back to single attestation when claim verification fails", async () => {
    const source = makeSource();
    const deps = createDeps({
      sourceView: makeSourceView(source),
      adapters: new Map([[source.provider, makeAdapter(source)]]),
    });
    const action = makeAction({ evidence: [source.id] });
    verifyAttestedValuesMock.mockReturnValue([
      {
        claim: { text: "Bitcoin at $64,231", type: "price", entities: ["bitcoin", "BTC"], value: 64231, unit: "USD" },
        attestedValue: 63000,
        expectedValue: 64231,
        verified: false,
        failureReason: "drift",
      },
    ]);

    await executePublishActions([action], deps);

    expect(executeAttestationPlanMock).toHaveBeenCalledOnce();
    expect(attestDahrMock).toHaveBeenCalledWith(deps.demos, source.url);
    const publishInput = publishPostMock.mock.calls[0][1];
    expect(publishInput.sourceAttestations[0].txHash).toBe("0xfallback-attestation");
  });

  it("does not broadcast or mutate publish state in dry-run mode", async () => {
    const source = makeSource();
    const deps = createDeps({
      dryRun: true,
      sourceView: makeSourceView(source),
      adapters: new Map([[source.provider, makeAdapter(source)]]),
    });
    const action = makeAction({ evidence: [source.id] });

    const result = await executePublishActions([action], deps);

    expect(result.executed).toEqual([
      expect.objectContaining({
        action,
        success: true,
        attestationType: "none",
      }),
    ]);
    expect(executeAttestationPlanMock).not.toHaveBeenCalled();
    expect(attestDahrMock).not.toHaveBeenCalled();
    expect(publishPostMock).not.toHaveBeenCalled();
    expect(deps.state.posts).toEqual([]);
    expect(deps.state.publishedPosts).toBeUndefined();
    expect(deps.logSession).not.toHaveBeenCalled();
    expect(deps.logQuality).not.toHaveBeenCalled();
  });

  it("skips gracefully when the provider is missing", async () => {
    const deps = createDeps({ provider: null });
    const action = makeAction();

    const result = await executePublishActions([action], deps);

    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([{ action, reason: "no provider" }]);
    expect(generatePostMock).not.toHaveBeenCalled();
  });

  it("rejects drafts that fail the substantiation gate", async () => {
    const deps = createDeps();
    const action = makeAction();
    matchMock.mockResolvedValue({
      pass: false,
      reason: "threshold not met",
      reasonCode: "MATCH_THRESHOLD_NOT_MET",
      considered: [],
    });

    const result = await executePublishActions([action], deps);

    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([{ action, reason: "unsubstantiated draft" }]);
    expect(attestDahrMock).not.toHaveBeenCalled();
    expect(publishPostMock).not.toHaveBeenCalled();
  });

  it("returns empty results for an empty action array", async () => {
    const deps = createDeps();

    const result = await executePublishActions([], deps);

    expect(result).toEqual({ executed: [], skipped: [] });
  });

  describe("VOTE/BET session budget", () => {
    function makeVoteAction(amount = 2): StrategyAction {
      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      return {
        type: "VOTE",
        priority: 50,
        reason: "Test prediction",
        metadata: {
          action: "HIVE_BET",
          asset: "BTC",
          direction: "up",
          confidence: 80,
          amount,
          expiry,
        },
      };
    }

    function makeBetAction(amount = 1): StrategyAction {
      return {
        type: "BET",
        priority: 50,
        reason: "Binary market bet",
        metadata: {
          action: "HIVE_BINARY",
          market: "Will ETH hit 5000",
          position: "yes",
          amount,
        },
      };
    }

    const freshLedger = () => ({
      address: "demos1sentinel",
      date: new Date().toISOString().slice(0, 10),
      dailySpent: 0,
      sessionSpent: 0,
      transactions: [],
    });

    const policy = {
      dailyCapDem: 10,
      sessionCapDem: 5,
      maxPerTipDem: 3,
      requireConfirmation: false,
      dryRun: false,
      allowedRecipients: [],
    };

    it("skips VOTE when session budget is exceeded", async () => {
      checkSessionBudgetMock.mockReturnValue({ allowed: false, reason: "Session DEM cap exceeded (remaining: 0)", dryRun: false });
      const deps = createDeps({ spending: { policy, ledger: freshLedger() } });
      const action = makeVoteAction(2);

      const result = await executePublishActions([action], deps);

      expect(result.skipped).toEqual([
        expect.objectContaining({ reason: expect.stringContaining("Budget rejected") }),
      ]);
      expect(result.executed).toEqual([]);
      expect(checkSessionBudgetMock).toHaveBeenCalledWith(2, policy, expect.any(Object));
    });

    it("allows VOTE when budget permits and records spend", async () => {
      checkSessionBudgetMock.mockReturnValue({ allowed: true, reason: "Within session budget", dryRun: false });
      const ledger = freshLedger();
      const deps = createDeps({ spending: { policy, ledger } });
      const action = makeVoteAction(2);

      const result = await executePublishActions([action], deps);

      expect(result.executed).toEqual([
        expect.objectContaining({ success: true, txHash: "0xbet-publish" }),
      ]);
      expect(checkSessionBudgetMock).toHaveBeenCalledWith(2, policy, ledger);
      expect(recordSpendMock).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 2, type: "bet", postTxHash: "0xbet-publish" }),
        ledger,
      );
    });

    it("skips BET when daily cap is exceeded", async () => {
      checkSessionBudgetMock.mockReturnValue({ allowed: false, reason: "Daily DEM cap exceeded (remaining: 0.5)", dryRun: false });
      const deps = createDeps({ spending: { policy, ledger: freshLedger() } });
      const action = makeBetAction(1);

      const result = await executePublishActions([action], deps);

      expect(result.skipped).toEqual([
        expect.objectContaining({ reason: expect.stringContaining("Budget rejected") }),
      ]);
    });

    it("rejects VOTE with zero/invalid amount before budget check", async () => {
      const deps = createDeps({ spending: { policy, ledger: freshLedger() } });
      const action = makeVoteAction(0);

      const result = await executePublishActions([action], deps);

      expect(result.skipped).toEqual([
        expect.objectContaining({ reason: expect.stringContaining("Invalid bet amount") }),
      ]);
      expect(checkSessionBudgetMock).not.toHaveBeenCalled();
    });

    it("rejects VOTE when spending deps are missing", async () => {
      const deps = createDeps();
      const action = makeVoteAction(2);

      const result = await executePublishActions([action], deps);

      expect(result.skipped).toEqual([
        expect.objectContaining({ reason: "No spending policy configured — cannot execute bet" }),
      ]);
      expect(checkSessionBudgetMock).not.toHaveBeenCalled();
    });

    it("skips budget check in dry-run mode", async () => {
      const deps = createDeps({ dryRun: true, spending: { policy, ledger: freshLedger() } });
      const action = makeVoteAction(2);

      const result = await executePublishActions([action], deps);

      expect(result.executed).toEqual([expect.objectContaining({ success: true })]);
      expect(checkSessionBudgetMock).not.toHaveBeenCalled();
      expect(recordSpendMock).not.toHaveBeenCalled();
    });
  });
});
