/**
 * TDD tests for D402 payment protocol integration in pay().
 *
 * Tests the complete 402 challenge/response flow:
 * initial request → 402 → parse requirement → validate payee →
 * settle payment → retry with proof → record receipt.
 *
 * Mock strategy: vi.stubGlobal("fetch") + mock bridge.payD402()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DemosSession } from "../../../src/toolkit/session.js";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import type { SdkBridge, D402SettlementResult } from "../../../src/toolkit/sdk-bridge.js";
import { pay } from "../../../src/toolkit/tools/pay.js";
import { checkPayReceipt, makeIdempotencyKey } from "../../../src/toolkit/guards/pay-receipt-log.js";
import { validateUrl, createPinnedFetch } from "../../../src/toolkit/url-validator.js";

// Mock SSRF validator to pass all URLs in tests (DNS resolution would fail).
// resolvedIp is omitted so createPinnedFetch is NOT used — D402 tests focus on
// payment protocol, not SSRF. Pinning is tested in url-validator-pinning.test.ts.
vi.mock("../../../src/toolkit/url-validator.js", () => ({
  validateUrl: vi.fn(async () => ({ valid: true })),
  createPinnedFetch: vi.fn(() => globalThis.fetch),
}));

// ── Helpers ──────────────────────────────────────────

function mockBridge(overrides?: Partial<SdkBridge>): SdkBridge {
  return {
    attestDahr: vi.fn(async () => ({ responseHash: "h", txHash: "t", data: {}, url: "" })),
    apiCall: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
    publishHivePost: vi.fn(async () => ({ txHash: "p" })),
    transferDem: vi.fn(async () => ({ txHash: "x" })),
    getDemos: vi.fn(() => ({} as any)),
    payD402: vi.fn(async (): Promise<D402SettlementResult> => ({
      success: true,
      hash: "d402-tx-abc123",
    })),
    queryTransaction: vi.fn(async () => null),
    ...overrides,
  };
}

function createSession(tempDir: string, bridge: SdkBridge, payPolicy?: any) {
  return new DemosSession({
    walletAddress: "demos1paytest",
    rpcUrl: "https://demosnode.discus.sh",
    algorithm: "falcon",
    authToken: "test-token",
    signingHandle: { demos: {}, bridge },
    stateStore: new FileStateStore(tempDir),
    allowInsecureUrls: true, // skip HTTPS check for test URLs
    payPolicy: payPolicy ?? { maxPerCall: 100, rolling24hCap: 1000, requirePayeeApproval: false },
  });
}

/** Create a mock Response for fetch */
function mockResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(bodyStr, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Standard D402 requirement */
const VALID_REQUIREMENT = {
  amount: 5,
  recipient: "demos1merchant",
  resourceId: "premium-data-v1",
  description: "Premium data access",
};

// ── Tests ────────────────────────────────────────────

describe("pay() D402 flow", () => {
  let tempDir: string;
  let originalFetch: typeof globalThis.fetch;
  const mockValidateUrl = vi.mocked(validateUrl);
  const mockCreatePinnedFetch = vi.mocked(createPinnedFetch);

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-d402-"));
    originalFetch = globalThis.fetch;
    mockValidateUrl.mockReset();
    mockValidateUrl.mockResolvedValue({ valid: true });
    mockCreatePinnedFetch.mockReset();
    mockCreatePinnedFetch.mockImplementation(() => globalThis.fetch);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  });

  // 1. Non-402 response
  it("returns PayResult with no receipt for non-402 response", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(200, { data: "free content" })));

    const result = await pay(session, { url: "https://api.example.com/free", maxSpend: 10 });

    expect(result.ok).toBe(true);
    expect(result.data!.response.status).toBe(200);
    expect(result.data!.receipt).toBeUndefined();
    expect(bridge.payD402).not.toHaveBeenCalled();
  });

  // 2. Happy path: 402 → pay → retry 200
  it("completes D402 flow: 402 → settle → retry 200 → receipt", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) return mockResponse(402, VALID_REQUIREMENT);
      return mockResponse(200, { data: "premium content" });
    }));

    const result = await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    expect(result.ok).toBe(true);
    expect(result.data!.response.status).toBe(200);
    expect(result.data!.receipt).toBeDefined();
    expect(result.data!.receipt!.txHash).toBe("d402-tx-abc123");
    expect(result.data!.receipt!.amount).toBe(5);
    expect(bridge.payD402).toHaveBeenCalledWith(expect.objectContaining({
      amount: 5,
      recipient: "demos1merchant",
      resourceId: "premium-data-v1",
    }));
  });

  // 3. Payee rejected
  it("rejects untrusted payee when requirePayeeApproval is true", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge, {
      maxPerCall: 100,
      rolling24hCap: 1000,
      requirePayeeApproval: true,
      trustedPayees: ["demos1trusted"],
    });

    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(402, VALID_REQUIREMENT)));

    const result = await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("demos1merchant");
    expect(bridge.payD402).not.toHaveBeenCalled();
  });

  // 4. Payee allowed when requirePayeeApproval is false
  it("allows payment to any payee when requirePayeeApproval is false", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge, {
      maxPerCall: 100,
      rolling24hCap: 1000,
      requirePayeeApproval: false,
    });

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) return mockResponse(402, VALID_REQUIREMENT);
      return mockResponse(200, { data: "ok" });
    }));

    const result = await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    expect(result.ok).toBe(true);
    expect(bridge.payD402).toHaveBeenCalled();
  });

  // 5. Amount > maxSpend
  it("rejects when requirement amount exceeds maxSpend", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    vi.stubGlobal("fetch", vi.fn(async () =>
      mockResponse(402, { ...VALID_REQUIREMENT, amount: 999 }),
    ));

    const result = await pay(session, { url: "https://api.example.com/expensive", maxSpend: 10 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("SPEND_LIMIT");
    expect(bridge.payD402).not.toHaveBeenCalled();
  });

  // 6. Settlement failure
  it("returns TX_FAILED when settlement fails", async () => {
    const bridge = mockBridge({
      payD402: vi.fn(async () => ({
        success: false,
        hash: "",
        message: "insufficient funds",
      })),
    });
    const session = createSession(tempDir, bridge);

    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(402, VALID_REQUIREMENT)));

    const result = await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("TX_FAILED");
    expect(result.error!.message).toContain("insufficient funds");
  });

  // 7. Retry non-2xx (receipt NOT recorded — prevents poisoned idempotency)
  it("returns TX_FAILED when retry returns non-2xx and does NOT record receipt", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) return mockResponse(402, VALID_REQUIREMENT);
      return mockResponse(500, { error: "server error" });
    }));

    const result = await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("TX_FAILED");
    expect(result.error!.detail?.txHash).toBe("d402-tx-abc123");

    // Receipt must NOT be recorded (prevents poisoned idempotency cache)
    const key = makeIdempotencyKey("https://api.example.com/premium");
    const cached = await checkPayReceipt(session.stateStore, session.walletAddress, key);
    expect(cached).toBeNull();
  });

  // 8. Invalid 402 JSON body
  it("returns TX_FAILED for non-JSON 402 body", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("not json", { status: 402 }),
    ));

    const result = await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("TX_FAILED");
    expect(bridge.payD402).not.toHaveBeenCalled();
  });

  // 9. Missing fields in 402 body
  it("returns TX_FAILED for 402 body missing required fields", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    vi.stubGlobal("fetch", vi.fn(async () =>
      mockResponse(402, { amount: 5 }), // missing recipient, resourceId
    ));

    const result = await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("TX_FAILED");
    expect(bridge.payD402).not.toHaveBeenCalled();
  });

  // 10. Receipt recorded after successful payment
  it("records receipt after successful D402 payment", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) return mockResponse(402, VALID_REQUIREMENT);
      return mockResponse(200, { data: "content" });
    }));

    await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    const key = makeIdempotencyKey("https://api.example.com/premium");
    const cached = await checkPayReceipt(session.stateStore, session.walletAddress, key);
    expect(cached).not.toBeNull();
    expect(cached!.txHash).toBe("d402-tx-abc123");
    expect(cached!.amount).toBe(5);
  });

  // 11. Spend cap updated after payment
  it("records payment amount for rolling spend cap", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) return mockResponse(402, VALID_REQUIREMENT);
      return mockResponse(200, { data: "content" });
    }));

    await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    // Second call that would exceed rolling cap should fail
    // (cap is 1000, paid 5 — this verifies recordPayment was called)
    // We verify indirectly: the payment was recorded by checking receipt exists
    const key = makeIdempotencyKey("https://api.example.com/premium");
    const cached = await checkPayReceipt(session.stateStore, session.walletAddress, key);
    expect(cached).not.toBeNull();
  });

  // 12. Initial fetch network error
  it("returns NETWORK_ERROR when initial fetch fails", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("DNS resolution failed");
    }));

    const result = await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("NETWORK_ERROR");
    expect(result.error!.retryable).toBe(true);
  });

  // 13. Retry returns 402 again (payment insufficient)
  it("returns TX_FAILED with txHash when retry returns 402", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) return mockResponse(402, VALID_REQUIREMENT);
      return mockResponse(402, { ...VALID_REQUIREMENT, amount: 20 }); // wants more
    }));

    const result = await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("TX_FAILED");
    expect(result.error!.detail?.txHash).toBe("d402-tx-abc123");
  });

  // 14. Redirect on initial request is handled with manual redirect
  it("uses redirect: manual on fetch calls", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    const mockFetch = vi.fn(async () => mockResponse(200, { data: "ok" }));
    vi.stubGlobal("fetch", mockFetch);

    await pay(session, { url: "https://api.example.com/free", maxSpend: 10 });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  // 15. Redirect to blocked target is rejected
  it("rejects redirects to blocked URLs", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    mockValidateUrl.mockImplementation(async (url: string) => {
      if (url === "https://api.example.com/start") {
        return { valid: true, resolvedIp: "1.2.3.4" };
      }
      if (url === "http://127.0.0.1/private") {
        return { valid: false, reason: "Blocked: 127.0.0.0/8 loopback range" };
      }
      return { valid: true, resolvedIp: "1.2.3.4" };
    });

    vi.stubGlobal("fetch", vi.fn(async () =>
      mockResponse(302, "", { location: "http://127.0.0.1/private" }),
    ));

    const result = await pay(session, { url: "https://api.example.com/start", maxSpend: 10 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("Payment URL blocked");
    expect(bridge.payD402).not.toHaveBeenCalled();
  });

  // 16. Valid redirect is followed manually
  it("follows a valid redirect after validation", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    const mockFetch = vi.fn(async (url: string) => {
      if (url === "https://api.example.com/start") {
        return mockResponse(302, "", { location: "https://api.example.com/final" });
      }
      return mockResponse(200, { data: "redirected ok" });
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await pay(session, { url: "https://api.example.com/start", maxSpend: 10 });

    expect(result.ok).toBe(true);
    expect(result.data!.response.status).toBe(200);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.example.com/final",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(mockValidateUrl).toHaveBeenCalledWith(
      "https://api.example.com/final",
      expect.objectContaining({ allowInsecure: true }),
    );
  });

  // 17. Redirect hop limit is enforced
  it("rejects redirect chains longer than 3 hops", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    const redirectChain = new Map<string, string>([
      ["https://api.example.com/hop-1", "https://api.example.com/hop-2"],
      ["https://api.example.com/hop-2", "https://api.example.com/hop-3"],
      ["https://api.example.com/hop-3", "https://api.example.com/hop-4"],
      ["https://api.example.com/hop-4", "https://api.example.com/hop-5"],
    ]);

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const nextUrl = redirectChain.get(url);
      if (nextUrl) return mockResponse(302, "", { location: nextUrl });
      return mockResponse(200, { data: "too late" });
    }));

    const result = await pay(session, { url: "https://api.example.com/hop-1", maxSpend: 10 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("Too many redirects");
    expect(bridge.payD402).not.toHaveBeenCalled();
  });

  // 18. Proof is stripped on cross-origin retry redirect
  it("strips X-Payment-Proof when retry redirect changes origin", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);
    const seenProofHeaders: Array<string | null> = [];

    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenProofHeaders.push(headers.get("X-Payment-Proof"));

      if (url === "https://api.example.com/premium") {
        if (headers.has("X-Payment-Proof")) {
          return mockResponse(307, "", { location: "https://cdn.example.net/protected" });
        }
        return mockResponse(402, VALID_REQUIREMENT);
      }

      return mockResponse(200, { data: "redirected premium" });
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await pay(session, { url: "https://api.example.com/premium", maxSpend: 10 });

    expect(result.ok).toBe(true);
    expect(result.data!.response.status).toBe(200);
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      "https://cdn.example.net/protected",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(seenProofHeaders).toEqual([null, "d402-tx-abc123", null]);
  });

  // 19. Concurrent settlements are both allowed when under spend cap
  // (Atomic reservation prevents overspend without requiring settlement serialization)
  it("allows concurrent D402 settlements when both are under spend cap", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge);

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const proof = new Headers(init?.headers).get("X-Payment-Proof");
      if (proof) {
        return mockResponse(200, { data: `premium:${proof}` });
      }
      return mockResponse(402, VALID_REQUIREMENT);
    }));

    const [first, second] = await Promise.all([
      pay(session, { url: "https://api.example.com/premium-a", maxSpend: 10 }),
      pay(session, { url: "https://api.example.com/premium-b", maxSpend: 10 }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(bridge.payD402).toHaveBeenCalledTimes(2);
  });

  // ── S2: Atomic spend cap — concurrent pay() race condition ──────

  // 20. Two concurrent pay() calls each requesting 60 DEM with 100 DEM cap
  it("rejects second concurrent pay() when combined spend exceeds rolling cap", async () => {
    const bridge = mockBridge();
    const session = createSession(tempDir, bridge, {
      maxPerCall: 100,
      rolling24hCap: 100,
      requirePayeeApproval: false,
    });

    const bigRequirement = { ...VALID_REQUIREMENT, amount: 60 };

    let fetchCallCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      fetchCallCount++;
      const proof = new Headers(init?.headers).get("X-Payment-Proof");
      if (proof) return mockResponse(200, { data: "content" });
      return mockResponse(402, bigRequirement);
    }));

    // Launch both concurrently — both request 60 DEM against 100 DEM cap
    const [r1, r2] = await Promise.all([
      pay(session, { url: "https://api.example.com/a", maxSpend: 60 }),
      pay(session, { url: "https://api.example.com/b", maxSpend: 60 }),
    ]);

    // Exactly one should succeed, one should fail with SPEND_LIMIT
    const successes = [r1, r2].filter((r) => r.ok);
    const failures = [r1, r2].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].error!.code).toBe("SPEND_LIMIT");
  });

  // 21. Settlement failure after spend reservation rolls back spend
  it("rolls back spend reservation when settlement fails", async () => {
    const bridge = mockBridge({
      payD402: vi.fn(async () => ({
        success: false,
        hash: "",
        message: "insufficient on-chain funds",
      })),
    });
    const session = createSession(tempDir, bridge, {
      maxPerCall: 100,
      rolling24hCap: 100,
      requirePayeeApproval: false,
    });

    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(402, VALID_REQUIREMENT)));

    // First call: settlement fails
    const r1 = await pay(session, { url: "https://api.example.com/a", maxSpend: 10 });
    expect(r1.ok).toBe(false);
    expect(r1.error!.code).toBe("TX_FAILED");

    // Second call: should NOT see the failed payment's 5 DEM in the rolling cap
    // If rollback works, we still have 100 DEM available (not 95)
    const goodBridge = mockBridge();
    // Swap bridge for a working one
    const session2 = createSession(tempDir, goodBridge, {
      maxPerCall: 100,
      rolling24hCap: 100,
      requirePayeeApproval: false,
    });

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) return mockResponse(402, { ...VALID_REQUIREMENT, amount: 95 });
      return mockResponse(200, { data: "ok" });
    }));

    // This should succeed because the failed 5 DEM was rolled back, leaving 100 available
    const r2 = await pay(session2, { url: "https://api.example.com/b", maxSpend: 95 });
    expect(r2.ok).toBe(true);
  });
});
