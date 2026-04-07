/**
 * Audit fixes WS7 — rate-limit reservation rollback on exit paths.
 *
 * H1: Optimistic reservation must be rolled back on all non-success exit paths.
 * L2: Tests for pre-publish exit paths verifying rollback is called.
 *
 * See also: audit-fixes-ws7-rollback.test.ts for H2 (ID-based rollback unit tests).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { StrategyAction } from "../../cli/v3-strategy-bridge.js";
import type { PublishExecutorDeps } from "../../cli/publish-executor.js";
import type { V3SessionState } from "../../src/lib/state.js";
import type { SourceRecordV2, AgentSourceView } from "../../src/lib/sources/catalog.js";

const {
  generatePostMock, publishPostMock, checkAndRecordWriteMock,
  getWriteRateRemainingMock, rollbackWriteRecordMock, preflightMock,
  matchMock, extractStructuredClaimsAutoMock, buildAttestationPlanMock,
  verifyAttestedValuesMock, executeAttestationPlanMock, attestDahrMock,
  attestTlsnMock, fetchSourceMock, selectSourceForTopicV2Mock,
  resolveAttestationPlanMock, getPostMock, createSdkBridgeMock,
  checkSessionBudgetMock, recordSpendMock, saveSpendingLedgerMock,
} = vi.hoisted(() => ({
  generatePostMock: vi.fn(), publishPostMock: vi.fn(),
  checkAndRecordWriteMock: vi.fn(), getWriteRateRemainingMock: vi.fn(),
  rollbackWriteRecordMock: vi.fn(), preflightMock: vi.fn(),
  matchMock: vi.fn(), extractStructuredClaimsAutoMock: vi.fn(),
  buildAttestationPlanMock: vi.fn(), verifyAttestedValuesMock: vi.fn(),
  executeAttestationPlanMock: vi.fn(), attestDahrMock: vi.fn(),
  attestTlsnMock: vi.fn(), fetchSourceMock: vi.fn(),
  selectSourceForTopicV2Mock: vi.fn(), resolveAttestationPlanMock: vi.fn(),
  getPostMock: vi.fn(), createSdkBridgeMock: vi.fn(),
  checkSessionBudgetMock: vi.fn(), recordSpendMock: vi.fn(),
  saveSpendingLedgerMock: vi.fn(),
}));

vi.mock("../../src/actions/llm.js", () => ({ generatePost: generatePostMock }));
vi.mock("../../src/actions/attestation-executor.js", () => ({ executeAttestationPlan: executeAttestationPlanMock }));
vi.mock("../../src/actions/publish-pipeline.js", () => ({ attestDahr: attestDahrMock, attestTlsn: attestTlsnMock, publishPost: publishPostMock }));
vi.mock("../../src/lib/attestation/claim-extraction.js", () => ({ extractStructuredClaimsAuto: extractStructuredClaimsAutoMock }));
vi.mock("../../src/lib/attestation/attestation-planner.js", () => ({ buildAttestationPlan: buildAttestationPlanMock, verifyAttestedValues: verifyAttestedValuesMock }));
vi.mock("../../src/lib/attestation/attestation-policy.js", () => ({ resolveAttestationPlan: resolveAttestationPlanMock }));
vi.mock("../../src/lib/sources/fetch.js", () => ({ fetchSource: fetchSourceMock }));
vi.mock("../../src/lib/sources/policy.js", () => ({ preflight: preflightMock, selectSourceForTopicV2: selectSourceForTopicV2Mock }));
vi.mock("../../src/lib/sources/matcher.js", () => ({ match: matchMock }));
vi.mock("../../src/toolkit/colony/posts.js", () => ({ getPost: getPostMock }));
vi.mock("../../src/toolkit/guards/write-rate-limit.js", () => ({ checkAndRecordWrite: checkAndRecordWriteMock, getWriteRateRemaining: getWriteRateRemainingMock, rollbackWriteRecord: rollbackWriteRecordMock }));
vi.mock("../../src/toolkit/sdk-bridge.js", () => ({ createSdkBridge: createSdkBridgeMock, AUTH_PENDING_TOKEN: "AUTH_PENDING" }));
vi.mock("../../src/lib/spending-policy.js", () => ({ checkSessionBudget: checkSessionBudgetMock, recordSpend: recordSpendMock, saveSpendingLedger: saveSpendingLedgerMock }));

import { executePublishActions } from "../../cli/publish-executor.js";

const RESERVATION_TS = 1700000000000;

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "btc-source", name: "BTC Source", provider: "market",
    url: "https://source.test/data", urlPattern: "https://source.test/data",
    topics: ["bitcoin"], tlsn_safe: true, dahr_safe: true, max_response_kb: 8,
    topicAliases: ["btc"], domainTags: ["bitcoin", "price"], responseFormat: "json",
    scope: { visibility: "global", importedFrom: ["sentinel"] },
    runtime: { timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 10, retryOn: [] } },
    adapter: { operation: "price" }, trustTier: "official", status: "active",
    rating: { overall: 90, uptime: 90, relevance: 90, freshness: 90, sizeStability: 90, engagement: 90, trust: 90, testCount: 1, successCount: 1, consecutiveFailures: 0 },
    lifecycle: { discoveredAt: "2026-03-01T00:00:00.000Z", discoveredBy: "manual" },
    ...overrides,
  };
}

function makeSourceView(source: SourceRecordV2): AgentSourceView {
  return {
    agent: "sentinel", catalogVersion: 2, sources: [source],
    index: { byId: new Map([[source.id, source]]), byTopicToken: new Map(), byDomainTag: new Map(), byProvider: new Map(), byAgent: new Map(), byMethod: { TLSN: new Set([source.id]), DAHR: new Set([source.id]) } },
  };
}

function makeState(): V3SessionState {
  return { loopVersion: 3, sessionNumber: 7, agentName: "sentinel", startedAt: "2026-03-31T00:00:00.000Z", pid: 123, phases: { sense: { status: "pending" }, act: { status: "pending" }, confirm: { status: "pending" } }, posts: [], engagements: [] };
}

function makeAction(overrides: Partial<StrategyAction> = {}): StrategyAction {
  return { type: "PUBLISH", priority: 100, reason: "Share market update", metadata: { topics: ["bitcoin"] }, ...overrides };
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    text: "Bitcoin is trading at $64,231 with ETF net inflows of $1.2B this week, and the spread between spot and futures continues to compress as institutional demand stabilizes across the major venues. Funding has cooled while spot demand remains firm, which keeps the setup verifiable and materially different from the last rotation.",
    category: "ANALYSIS", tags: ["bitcoin", "etf"], confidence: 84,
    hypothesis: "ETF demand remains persistent", predicted_reactions: 21, ...overrides,
  };
}

function createDeps(overrides: Partial<PublishExecutorDeps> = {}): PublishExecutorDeps {
  const source = makeSource();
  return {
    demos: {} as any, walletAddress: "demos1sentinel",
    provider: { name: "test-llm", complete: vi.fn() } as any,
    agentConfig: { name: "sentinel", paths: { personaMd: "/tmp/persona.md", strategyYaml: "/tmp/strategy.yaml" }, gate: { predictedReactionsThreshold: 10 }, attestation: { defaultMode: "dahr_only", highSensitivityRequireTlsn: false, highSensitivityKeywords: [] } } as any,
    sourceView: makeSourceView(source), state: makeState(), sessionsDir: "/tmp/sessions",
    observe: vi.fn(), dryRun: false, stateStore: {} as any, colonyDb: undefined,
    calibrationOffset: 0.25, scanContext: { activity_level: "moderate", posts_per_hour: 12, gaps: ["bitcoin"] },
    adapters: new Map([[source.provider, { provider: source.provider, domains: ["source.test"], rateLimit: { bucket: source.provider, maxPerMinute: 10, maxPerDay: 100 }, supports: vi.fn().mockImplementation((c: any) => c.id === source.id), buildCandidates: vi.fn().mockReturnValue([]), validateCandidate: vi.fn().mockReturnValue({ ok: true }), parseResponse: vi.fn().mockReturnValue({ entries: [{ id: "e1", title: "BTC", summary: "s", bodyText: "b", topics: ["bitcoin"], metrics: {}, raw: {} }], normalized: { price: 64231 } }) }]]),
    usageTracker: { usageCount: new Map(), providersUsed: new Set() },
    logSession: vi.fn(), logQuality: vi.fn(), ...overrides,
  };
}

function configureSuccessMocks(source: SourceRecordV2): void {
  const url = source.url;
  const candidate = { sourceId: source.id, source, method: "DAHR" as const, url, score: 88 };
  resolveAttestationPlanMock.mockReturnValue({ required: "DAHR", fallback: null, sensitive: false, reason: "test policy" });
  selectSourceForTopicV2Mock.mockReturnValue({ source, url, score: 88 });
  fetchSourceMock.mockResolvedValue({ ok: true, response: { url, status: 200, headers: {}, bodyText: '{"price":64231}' }, attempts: 1, totalMs: 5 });
  generatePostMock.mockResolvedValue(makeDraft());
  preflightMock.mockReturnValue({ pass: true, reason: "DAHR source available", reasonCode: "PASS", candidates: [candidate], plan: { required: "DAHR", fallback: null, sensitive: false, reason: "test policy" } });
  matchMock.mockResolvedValue({ pass: true, reason: "matched", reasonCode: "PASS", best: { sourceId: source.id, method: "DAHR", url, score: 91, matchedClaims: ["bitcoin"], evidence: ["1 title match"] }, considered: [{ sourceId: source.id, score: 91 }] });
  extractStructuredClaimsAutoMock.mockResolvedValue([{ text: "Bitcoin at $64,231", type: "price", entities: ["bitcoin"], value: 64231, unit: "USD" }]);
  buildAttestationPlanMock.mockReturnValue({ primary: { claim: { text: "Bitcoin at $64,231", type: "price", entities: ["bitcoin"], value: 64231, unit: "USD" }, url, estimatedSizeBytes: 512, method: "GET", extractionPath: "$.price", provider: source.provider, rateLimitBucket: source.provider, plannedMethod: "DAHR" }, secondary: [], fallbacks: [], unattested: [], estimatedCost: 1, budget: { maxCostPerPost: 15, maxTlsnPerPost: 1, maxDahrPerPost: 3, maxAttestationsPerPost: 4 } });
  executeAttestationPlanMock.mockResolvedValue({ results: [{ type: "dahr", url, requestedUrl: url, responseHash: "0xclaim-hash", txHash: "0xclaim-attestation", data: { price: 64231 } }], skipped: [], failed: [] });
  verifyAttestedValuesMock.mockReturnValue([{ claim: { text: "Bitcoin at $64,231", type: "price", entities: ["bitcoin"], value: 64231, unit: "USD" }, attestedValue: 64231, expectedValue: 64231, verified: true }]);
  attestDahrMock.mockResolvedValue({ type: "dahr", url, requestedUrl: url, responseHash: "0xfallback-hash", txHash: "0xfallback-attestation", data: { price: 64231 } });
  publishPostMock.mockResolvedValue({ txHash: "0xpublish", category: "ANALYSIS", textLength: 285 });
}

describe("H1: Publish executor rollback on exit paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAndRecordWriteMock.mockResolvedValue({ error: null, recordedTimestamp: RESERVATION_TS });
    getWriteRateRemainingMock.mockResolvedValue({ dailyRemaining: 14, hourlyRemaining: 5 });
    rollbackWriteRecordMock.mockResolvedValue(undefined);
    getPostMock.mockReturnValue(null);
    createSdkBridgeMock.mockReturnValue({ publishHivePost: vi.fn().mockResolvedValue({ txHash: "0xbet-publish" }) });
    checkSessionBudgetMock.mockReturnValue({ allowed: true, reason: "Within session budget", dryRun: false });
    configureSuccessMocks(makeSource());
  });

  it("does NOT rollback when publish succeeds", async () => {
    const deps = createDeps();
    await executePublishActions([makeAction()], deps);
    expect(rollbackWriteRecordMock).not.toHaveBeenCalled();
  });

  it("rolls back when no provider is available after reservation", async () => {
    const deps = createDeps({ provider: null });
    await executePublishActions([makeAction()], deps);
    expect(rollbackWriteRecordMock).toHaveBeenCalledWith(deps.stateStore, deps.walletAddress, RESERVATION_TS);
  });

  it("rolls back when no source is found after reservation", async () => {
    selectSourceForTopicV2Mock.mockReturnValue(null);
    const emptyView: AgentSourceView = { agent: "sentinel", catalogVersion: 2, sources: [], index: { byId: new Map(), byTopicToken: new Map(), byDomainTag: new Map(), byProvider: new Map(), byAgent: new Map(), byMethod: { TLSN: new Set(), DAHR: new Set() } } };
    const deps = createDeps({ sourceView: emptyView });
    await executePublishActions([makeAction({ evidence: ["missing-source"] })], deps);
    expect(rollbackWriteRecordMock).toHaveBeenCalledWith(deps.stateStore, deps.walletAddress, RESERVATION_TS);
  });

  it("rolls back on dry-run (reservation should not be consumed)", async () => {
    const deps = createDeps({ dryRun: true });
    await executePublishActions([makeAction()], deps);
    expect(rollbackWriteRecordMock).toHaveBeenCalledWith(deps.stateStore, deps.walletAddress, RESERVATION_TS);
  });

  it("rolls back when preflight/match fails", async () => {
    matchMock.mockResolvedValue({ pass: false, reason: "threshold not met", reasonCode: "MATCH_THRESHOLD_NOT_MET", considered: [] });
    const deps = createDeps();
    await executePublishActions([makeAction()], deps);
    expect(rollbackWriteRecordMock).toHaveBeenCalledWith(deps.stateStore, deps.walletAddress, RESERVATION_TS);
  });

  it("rolls back when LLM generation fails", async () => {
    generatePostMock.mockRejectedValue(new Error("LLM timeout"));
    const deps = createDeps();
    await executePublishActions([makeAction()], deps);
    expect(rollbackWriteRecordMock).toHaveBeenCalledWith(deps.stateStore, deps.walletAddress, RESERVATION_TS);
  });

  it("rolls back when draft is too short", async () => {
    generatePostMock.mockResolvedValue(makeDraft({ text: "Too short" }));
    const deps = createDeps();
    await executePublishActions([makeAction()], deps);
    expect(rollbackWriteRecordMock).toHaveBeenCalledWith(deps.stateStore, deps.walletAddress, RESERVATION_TS);
  });

  it("rolls back when predicted reactions below threshold", async () => {
    generatePostMock.mockResolvedValue(makeDraft({ predicted_reactions: 1 }));
    const deps = createDeps();
    await executePublishActions([makeAction()], deps);
    expect(rollbackWriteRecordMock).toHaveBeenCalledWith(deps.stateStore, deps.walletAddress, RESERVATION_TS);
  });

  it("rolls back when chain publish fails", async () => {
    publishPostMock.mockRejectedValue(new Error("chain error"));
    const deps = createDeps();
    await executePublishActions([makeAction()], deps);
    expect(rollbackWriteRecordMock).toHaveBeenCalledWith(deps.stateStore, deps.walletAddress, RESERVATION_TS);
  });
});
