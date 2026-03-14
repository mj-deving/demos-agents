import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LLMProvider } from "../tools/lib/llm-provider.js";
import type { AgentSourceView } from "../tools/lib/sources/catalog.js";
import type { PreflightCandidate } from "../tools/lib/sources/policy.js";
import type { MatchResult } from "../tools/lib/sources/matcher.js";

// ── Mocks ────────────────────────────────────────────

const matchMock = vi.hoisted(() => vi.fn());
const preflightMock = vi.hoisted(() => vi.fn());

vi.mock("../tools/lib/sources/matcher.js", () => ({
  match: matchMock,
}));

vi.mock("../tools/lib/sources/policy.js", () => ({
  preflight: preflightMock,
}));

vi.mock("../tools/lib/sdk.js", () => ({
  apiCall: vi.fn(),
  info: vi.fn(),
}));

import {
  runAfterPublishDraft,
  type AfterPublishDraftContext,
} from "../tools/lib/extensions.js";

// ── Fixtures ─────────────────────────────────────────

function makeLLM(): LLMProvider {
  return {
    name: "test-provider",
    complete: vi.fn().mockResolvedValue('["bitcoin", "price"]'),
  };
}

const emptySourceView: AgentSourceView = {
  agent: "sentinel",
  catalogVersion: 2,
  sources: [],
  activeCount: 0,
  quarantinedCount: 0,
  mode: "catalog-preferred",
};

function makeContext(overrides: Partial<AfterPublishDraftContext> = {}): AfterPublishDraftContext {
  return {
    topic: "Bitcoin price analysis",
    postText: "Bitcoin is trading at $64,000 with 45% increase.",
    postTags: ["bitcoin", "crypto"],
    category: "ANALYSIS",
    config: {} as any,
    state: {} as any,
    preflightCandidates: [
      {
        sourceId: "coingecko-btc",
        source: {} as any,
        method: "TLSN",
        url: "https://api.example.com/btc",
        score: 75,
      } as PreflightCandidate,
    ],
    sourceView: emptySourceView,
    ...overrides,
  };
}

const passResult: MatchResult = {
  pass: true,
  reason: "Source matches",
  reasonCode: "PASS",
  best: {
    sourceId: "coingecko-btc",
    method: "TLSN",
    url: "https://api.example.com/btc",
    score: 75,
    matchedClaims: ["bitcoin"],
    evidence: ["1 title match(es)"],
  },
  considered: [{ sourceId: "coingecko-btc", score: 75 }],
};

// ── Tests ────────────────────────────────────────────

describe("extensions LLM wiring", () => {
  beforeEach(() => {
    matchMock.mockReset();
    preflightMock.mockReset();
    matchMock.mockResolvedValue(passResult);
  });

  it("passes llm from context to sourcesMatch when present", async () => {
    const llm = makeLLM();
    const ctx = makeContext({ llm });

    await runAfterPublishDraft(["sources"], ctx);

    expect(matchMock).toHaveBeenCalledOnce();
    const callArg = matchMock.mock.calls[0][0];
    expect(callArg.llm).toBe(llm);
  });

  it("passes undefined for llm when context has no llm field", async () => {
    const ctx = makeContext(); // no llm field

    await runAfterPublishDraft(["sources"], ctx);

    expect(matchMock).toHaveBeenCalledOnce();
    const callArg = matchMock.mock.calls[0][0];
    expect(callArg.llm).toBeUndefined();
  });

  it("passes null for llm when context has llm=null", async () => {
    const ctx = makeContext({ llm: null });

    await runAfterPublishDraft(["sources"], ctx);

    expect(matchMock).toHaveBeenCalledOnce();
    const callArg = matchMock.mock.calls[0][0];
    expect(callArg.llm).toBeNull();
  });

  it("does not break existing hook dispatch with llm set", async () => {
    const llm = makeLLM();
    const ctx = makeContext({ llm });

    const result = await runAfterPublishDraft(["sources"], ctx);

    expect(result).toBeDefined();
    expect(result!.pass).toBe(true);
    expect(result!.best?.sourceId).toBe("coingecko-btc");
  });

  it("returns valid SourceMatchDecision when llm is null", async () => {
    const ctx = makeContext({ llm: null });

    const result = await runAfterPublishDraft(["sources"], ctx);

    expect(result).toBeDefined();
    expect(result!.pass).toBe(true);
    expect(result!.reason).toBe("Source matches");
  });

  it("skips sources hook when no sourceView provided", async () => {
    const ctx = makeContext({ sourceView: undefined, llm: makeLLM() });

    const result = await runAfterPublishDraft(["sources"], ctx);

    // Hook returns undefined when no sourceView
    expect(result).toBeUndefined();
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("skips sources hook when no preflightCandidates", async () => {
    const ctx = makeContext({ preflightCandidates: undefined, llm: makeLLM() });

    const result = await runAfterPublishDraft(["sources"], ctx);

    expect(result).toBeUndefined();
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("propagates all MatchInput fields correctly", async () => {
    const llm = makeLLM();
    const ctx = makeContext({ llm });

    await runAfterPublishDraft(["sources"], ctx);

    const callArg = matchMock.mock.calls[0][0];
    expect(callArg.topic).toBe("Bitcoin price analysis");
    expect(callArg.postText).toBe("Bitcoin is trading at $64,000 with 45% increase.");
    expect(callArg.postTags).toEqual(["bitcoin", "crypto"]);
    expect(callArg.candidates).toEqual(ctx.preflightCandidates);
    expect(callArg.sourceView).toBe(emptySourceView);
    expect(callArg.llm).toBe(llm);
  });
});
