/**
 * Tests for attestation executor (Phase 3 — execution).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SurgicalCandidate } from "../src/lib/sources/providers/types.js";
import type { ExtractedClaim } from "../src/lib/claim-extraction.js";
import type { AttestationPlan, AttestationBudget } from "../src/lib/attestation-planner.js";

// Mock the dependencies
vi.mock("../src/actions/publish-pipeline.js", () => ({
  attestDahr: vi.fn(),
  attestTlsn: vi.fn(),
}));

vi.mock("../src/lib/sources/rate-limit.js", () => ({
  acquireRateLimitToken: vi.fn(),
}));

vi.mock("../src/lib/observe.js", () => ({
  observe: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────

function makeClaim(overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return {
    text: "BTC at $64,231",
    type: "price",
    entities: ["bitcoin", "BTC"],
    value: 64231,
    unit: "USD",
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<SurgicalCandidate> = {}): SurgicalCandidate {
  return {
    claim: makeClaim(),
    url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    estimatedSizeBytes: 512,
    method: "GET",
    extractionPath: "$.price",
    provider: "binance",
    rateLimitBucket: "binance",
    ...overrides,
  };
}

const DEFAULT_BUDGET: AttestationBudget = {
  maxCostPerPost: 15,
  maxTlsnPerPost: 1,
  maxDahrPerPost: 3,
  maxAttestationsPerPost: 4,
};

function makePlan(overrides: Partial<AttestationPlan> = {}): AttestationPlan {
  return {
    primary: makeCandidate(),
    secondary: [],
    fallbacks: [],
    unattested: [],
    estimatedCost: 1,
    budget: DEFAULT_BUDGET,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────

describe("executeAttestationPlan", () => {
  let attestDahr: ReturnType<typeof vi.fn>;
  let attestTlsn: ReturnType<typeof vi.fn>;
  let acquireRateLimitToken: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetAllMocks();

    const pipeline = await import("../src/actions/publish-pipeline.js");
    attestDahr = pipeline.attestDahr as any;
    attestTlsn = pipeline.attestTlsn as any;

    const rateLimit = await import("../src/lib/sources/rate-limit.js");
    acquireRateLimitToken = rateLimit.acquireRateLimitToken as any;

    // Default: rate limit allows, attestations succeed
    acquireRateLimitToken.mockReturnValue(true);
    attestDahr.mockResolvedValue({
      type: "dahr",
      url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      requestedUrl: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      responseHash: "abc123",
      txHash: "tx-dahr-1",
      data: { price: "64231" },
    });
    attestTlsn.mockResolvedValue({
      type: "tlsn",
      url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      requestedUrl: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      txHash: "tx-tlsn-1",
    });
  });

  it("calls attestation sequentially respecting plannedMethod", async () => {
    const { executeAttestationPlan } = await import("../src/actions/attestation-executor.js");

    const plan = makePlan({
      primary: makeCandidate({ plannedMethod: "TLSN" }),
      secondary: [makeCandidate({ url: "https://other.com", rateLimitBucket: "other", plannedMethod: "DAHR" })],
    });

    const result = await executeAttestationPlan(plan, {} as any);

    expect(result.results).toHaveLength(2);
    // Primary uses TLSN (plannedMethod), secondary uses DAHR (plannedMethod)
    expect(attestTlsn).toHaveBeenCalledTimes(1);
    expect(attestDahr).toHaveBeenCalledTimes(1);
  });

  it("uses candidate.rateLimitBucket for rate limiting", async () => {
    const { executeAttestationPlan } = await import("../src/actions/attestation-executor.js");

    const plan = makePlan({
      primary: makeCandidate({ rateLimitBucket: "custom-bucket" }),
    });

    await executeAttestationPlan(plan, {} as any);

    expect(acquireRateLimitToken).toHaveBeenCalledWith("custom-bucket");
  });

  it("skips on rate-limit denial", async () => {
    const { executeAttestationPlan } = await import("../src/actions/attestation-executor.js");

    acquireRateLimitToken.mockReturnValue(false);

    const plan = makePlan();
    const result = await executeAttestationPlan(plan, {} as any);

    expect(result.results).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("falls back to DAHR on TLSN failure", async () => {
    const { executeAttestationPlan } = await import("../src/actions/attestation-executor.js");

    attestTlsn.mockRejectedValue(new Error("TLSN unavailable"));

    const plan = makePlan();
    const result = await executeAttestationPlan(plan, {} as any);

    expect(result.results).toHaveLength(1);
    expect(attestTlsn).toHaveBeenCalledTimes(1);
    expect(attestDahr).toHaveBeenCalledTimes(1);
  });

  it("uses DAHR directly for large responses", async () => {
    const { executeAttestationPlan } = await import("../src/actions/attestation-executor.js");

    const plan = makePlan({
      primary: makeCandidate({ estimatedSizeBytes: 20 * 1024 }), // > 16KB
    });

    const result = await executeAttestationPlan(plan, {} as any);

    expect(result.results).toHaveLength(1);
    expect(attestTlsn).not.toHaveBeenCalled();
    expect(attestDahr).toHaveBeenCalledTimes(1);
  });

  it("tracks failed attestations", async () => {
    const { executeAttestationPlan } = await import("../src/actions/attestation-executor.js");

    attestTlsn.mockRejectedValue(new Error("TLSN fail"));
    attestDahr.mockRejectedValue(new Error("DAHR fail"));

    const plan = makePlan();
    const result = await executeAttestationPlan(plan, {} as any);

    expect(result.results).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });
});
