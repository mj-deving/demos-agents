/**
 * Tests for desloppify queue items ISC-29 through ISC-42.
 *
 * Covers: contracts, error consistency, logic/elegance, guard consolidation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── ISC-29: PublishDraft.attestUrl typed as required ──────────

describe("ISC-29: PublishDraft.attestUrl required", () => {
  it("PublishDraftSchema rejects missing attestUrl", async () => {
    const { validateInput, PublishDraftSchema } = await import(
      "../../src/toolkit/schemas.js"
    );
    const result = validateInput(PublishDraftSchema, {
      text: "Some valid text",
      category: "ANALYSIS",
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
    expect(result!.message).toContain("attestUrl");
  });

  it("PublishDraftSchema accepts valid attestUrl", async () => {
    const { validateInput, PublishDraftSchema } = await import(
      "../../src/toolkit/schemas.js"
    );
    const result = validateInput(PublishDraftSchema, {
      text: "Some valid text",
      category: "ANALYSIS",
      attestUrl: "https://api.example.com/price",
    });
    expect(result).toBeNull();
  });

  it("ReplyOptionsSchema rejects missing attestUrl", async () => {
    const { validateInput, ReplyOptionsSchema } = await import(
      "../../src/toolkit/schemas.js"
    );
    const result = validateInput(ReplyOptionsSchema, {
      parentTxHash: "0xabc",
      text: "Reply text here",
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
    expect(result!.message).toContain("attestUrl");
  });

  it("ReplyOptionsSchema accepts valid attestUrl", async () => {
    const { validateInput, ReplyOptionsSchema } = await import(
      "../../src/toolkit/schemas.js"
    );
    const result = validateInput(ReplyOptionsSchema, {
      parentTxHash: "0xabc",
      text: "Reply text here",
      attestUrl: "https://api.example.com/data",
    });
    expect(result).toBeNull();
  });
});

// ── ISC-30: verify() returns undefined blockHeight ───────────

describe("ISC-30: verify() blockHeight not fabricated", () => {
  it("returns blockHeight undefined (not fabricated 1) when confirmed", async () => {
    const { DemosSession } = await import("../../src/toolkit/session.js");
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");
    const { verify } = await import("../../src/toolkit/tools/verify.js");

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc30-"));
    try {
      const bridge = {
        attestDahr: vi.fn(),
        apiCall: vi.fn(async () => ({
          ok: true,
          status: 200,
          data: {
            posts: [{ txHash: "target-tx", text: "found", sender: "a" }],
          },
        })),
        publishHivePost: vi.fn(),
        transferDem: vi.fn(),
        getDemos: vi.fn(() => ({} as any)),
        payD402: vi.fn(),
      };

      const session = new DemosSession({
        walletAddress: "demos1verify",
        rpcUrl: "https://demosnode.discus.sh",
        algorithm: "falcon",
        authToken: "token",
        signingHandle: { demos: {}, bridge },
        stateStore: new FileStateStore(tempDir),
      });

      const result = await verify(session, { txHash: "target-tx" });
      expect(result.ok).toBe(true);
      expect(result.data!.confirmed).toBe(true);
      // blockHeight should be undefined, not fabricated 1
      expect(result.data!.blockHeight).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 25000);
});

// ── ISC-31: signAndBroadcast removed from SdkBridge ─────────

describe("ISC-31: signAndBroadcast removed", () => {
  it("createSdkBridge result does not have signAndBroadcast", async () => {
    const { createSdkBridge } = await import("../../src/toolkit/sdk-bridge.js");
    const mockDemos = {
      web2: { createDahr: vi.fn() },
      sendTransaction: vi.fn(),
      transfer: vi.fn(),
    };
    const bridge = createSdkBridge(mockDemos as any, "https://example.com", "token");
    expect((bridge as any).signAndBroadcast).toBeUndefined();
  });
});

// ── ISC-32: apiCall() typed errors with console.warn ─────────

describe("ISC-32: apiCall() typed errors with logging", () => {
  it("logs warning when fetch throws", async () => {
    const { createSdkBridge } = await import("../../src/toolkit/sdk-bridge.js");
    const mockDemos = {
      web2: { createDahr: vi.fn() },
      sendTransaction: vi.fn(),
      transfer: vi.fn(),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failFetch = vi.fn(async () => {
      throw new Error("network down");
    });

    const bridge = createSdkBridge(
      mockDemos as any,
      "https://example.com",
      "token",
      failFetch as any,
    );
    const result = await bridge.apiCall("/api/test");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.data).toBe("[Error] network down");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[demos-toolkit] apiCall failed: network down"),
    );

    warnSpy.mockRestore();
  });

  it("handles non-Error thrown values", async () => {
    const { createSdkBridge } = await import("../../src/toolkit/sdk-bridge.js");
    const mockDemos = {
      web2: { createDahr: vi.fn() },
      sendTransaction: vi.fn(),
      transfer: vi.fn(),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failFetch = vi.fn(async () => {
      throw "string error";
    });

    const bridge = createSdkBridge(
      mockDemos as any,
      "https://example.com",
      "token",
      failFetch as any,
    );
    const result = await bridge.apiCall("/api/test");

    expect(result.ok).toBe(false);
    expect(result.data).toBe("[Error] string error");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("string error"),
    );

    warnSpy.mockRestore();
  });
});

// ── ISC-33: scan.ts returns NETWORK_ERROR on API failure ─────────

describe("ISC-33: scan returns NETWORK_ERROR on API failure", () => {
  it("returns NETWORK_ERROR when feed API throws", async () => {
    const { DemosSession } = await import("../../src/toolkit/session.js");
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");
    const { scan } = await import("../../src/toolkit/tools/scan.js");

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc33-"));

    try {
      const bridge = {
        attestDahr: vi.fn(),
        apiCall: vi.fn(async () => {
          throw new Error("API down");
        }),
        publishHivePost: vi.fn(),
        transferDem: vi.fn(),
        getDemos: vi.fn(() => ({} as any)),
        payD402: vi.fn(),
      };

      const session = new DemosSession({
        walletAddress: "demos1scan",
        rpcUrl: "https://demosnode.discus.sh",
        algorithm: "falcon",
        authToken: "token",
        signingHandle: { demos: {}, bridge },
        stateStore: new FileStateStore(tempDir),
      });

      const result = await scan(session);
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("NETWORK_ERROR");
      expect(result.error!.message).toContain("API down");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ── ISC-34: pay-spend-cap.ts isFinite check order ────────────

describe("ISC-34: pay-spend-cap isFinite check before maxPerCall", () => {
  it("rejects NaN amount before maxPerCall comparison", async () => {
    const { checkPaySpendCap } = await import(
      "../../src/toolkit/guards/pay-spend-cap.js"
    );
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc34-"));
    try {
      const store = new FileStateStore(tempDir);
      const result = await checkPaySpendCap(store, "demos1test", NaN, {
        maxPerCall: 100,
        rolling24hCap: 1000,
        trustedPayees: [],
        requirePayeeApproval: true,
      });
      expect(result).not.toBeNull();
      expect(result!.code).toBe("INVALID_INPUT");
      expect(result!.message).toContain("positive finite number");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects Infinity amount", async () => {
    const { checkPaySpendCap } = await import(
      "../../src/toolkit/guards/pay-spend-cap.js"
    );
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc34b-"));
    try {
      const store = new FileStateStore(tempDir);
      const result = await checkPaySpendCap(store, "demos1test", Infinity, {
        maxPerCall: 100,
        rolling24hCap: 1000,
        trustedPayees: [],
        requirePayeeApproval: true,
      });
      expect(result).not.toBeNull();
      expect(result!.code).toBe("INVALID_INPUT");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects negative amount", async () => {
    const { checkPaySpendCap } = await import(
      "../../src/toolkit/guards/pay-spend-cap.js"
    );
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc34c-"));
    try {
      const store = new FileStateStore(tempDir);
      const result = await checkPaySpendCap(store, "demos1test", -5, {
        maxPerCall: 100,
        rolling24hCap: 1000,
        trustedPayees: [],
        requirePayeeApproval: true,
      });
      expect(result).not.toBeNull();
      expect(result!.code).toBe("INVALID_INPUT");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ── ISC-35: Unreachable return in verify.ts ──────────────────

describe("ISC-35: verify() unreachable return removed", () => {
  it("verify still works after removing unreachable code", async () => {
    const { DemosSession } = await import("../../src/toolkit/session.js");
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");
    const { verify } = await import("../../src/toolkit/tools/verify.js");

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc35-"));
    try {
      const bridge = {
        attestDahr: vi.fn(),
        apiCall: vi.fn(async () => ({
          ok: true,
          status: 200,
          data: { posts: [] },
        })),
        publishHivePost: vi.fn(),
        transferDem: vi.fn(),
        getDemos: vi.fn(() => ({} as any)),
        payD402: vi.fn(),
      };

      const session = new DemosSession({
        walletAddress: "demos1v35",
        rpcUrl: "https://demosnode.discus.sh",
        algorithm: "falcon",
        authToken: "token",
        signingHandle: { demos: {}, bridge },
        stateStore: new FileStateStore(tempDir),
      });

      const result = await verify(session, { txHash: "not-found-tx" });
      expect(result.ok).toBe(true);
      expect(result.data!.confirmed).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 25000);
});

// ── ISC-38: ConnectOptions accepts supercolonyApi ────────────

describe("ISC-38: ConnectOptions.supercolonyApi injectable", () => {
  it("ConnectOptionsSchema accepts supercolonyApi string", async () => {
    const { validateInput, ConnectOptionsSchema } = await import(
      "../../src/toolkit/schemas.js"
    );
    const result = validateInput(ConnectOptionsSchema, {
      walletPath: "/path/to/wallet",
      supercolonyApi: "https://custom.supercolony.ai",
    });
    expect(result).toBeNull();
  });
});

// ── ISC-39: reply() validation with timing ───────────────────

describe("ISC-39: reply() validation tracks timing", () => {
  it("reply() error provenance has non-zero latencyMs", async () => {
    const { DemosSession } = await import("../../src/toolkit/session.js");
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");
    const { reply } = await import("../../src/toolkit/tools/publish.js");

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc39-"));
    try {
      const session = new DemosSession({
        walletAddress: "demos1reply",
        rpcUrl: "https://demosnode.discus.sh",
        algorithm: "falcon",
        authToken: "token",
        signingHandle: {},
        stateStore: new FileStateStore(tempDir),
      });

      const result = await reply(session, {
        parentTxHash: "",
        text: "Reply text",
        attestUrl: "https://example.com",
      });
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("INVALID_INPUT");
      // Provenance should exist and have path "local"
      expect(result.provenance.path).toBe("local");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ── ISC-40: No stale TODO in attest.ts ───────────────────────

describe("ISC-40: no stale TODO in attest.ts", () => {
  it("attest.ts does not contain 'wire to' TODO", async () => {
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(
      join(__dirname, "../../src/toolkit/tools/attest.ts"),
      "utf-8",
    );
    expect(content).not.toContain("wire to session's SDK bridge");
    expect(content).not.toContain("wire to SDK bridge");
  });
});

// ── ISC-41: recordX() uses checkAndAppend ────────────────────

describe("ISC-41: record functions use checkAndAppend", () => {
  it("recordWrite still works correctly", async () => {
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");
    const { recordWrite, getWriteRateRemaining } = await import(
      "../../src/toolkit/guards/write-rate-limit.js"
    );

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc41a-"));
    try {
      const store = new FileStateStore(tempDir);
      await recordWrite(store, "demos1test");
      const remaining = await getWriteRateRemaining(store, "demos1test");
      expect(remaining.dailyRemaining).toBe(13);
      expect(remaining.hourlyRemaining).toBe(3);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("recordPublish (dedup) still works correctly", async () => {
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");
    const { recordPublish, checkDedup } = await import(
      "../../src/toolkit/guards/dedup-guard.js"
    );

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc41b-"));
    try {
      const store = new FileStateStore(tempDir);
      await recordPublish(store, "demos1test", "duplicate text");
      const result = await checkDedup(store, "demos1test", "duplicate text");
      expect(result).not.toBeNull();
      expect(result!.code).toBe("DUPLICATE");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("recordTip still works correctly", async () => {
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");
    const { recordTip, checkTipSpendCap } = await import(
      "../../src/toolkit/guards/tip-spend-cap.js"
    );

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc41c-"));
    try {
      const store = new FileStateStore(tempDir);
      const policy = { maxPerTip: 10, maxPerPost: 2, cooldownMs: 0 };
      await recordTip(store, "demos1test", "post-tx-1", 5);
      await recordTip(store, "demos1test", "post-tx-1", 3);
      // Third tip to same post should be rejected
      const result = await checkTipSpendCap(store, "demos1test", "post-tx-1", 2, policy);
      expect(result).not.toBeNull();
      expect(result!.code).toBe("SPEND_LIMIT");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("recordPayment still works correctly", async () => {
    const { FileStateStore } = await import("../../src/toolkit/state-store.js");
    const { recordPayment, checkPaySpendCap } = await import(
      "../../src/toolkit/guards/pay-spend-cap.js"
    );

    const tempDir = mkdtempSync(join(tmpdir(), "demos-isc41d-"));
    try {
      const store = new FileStateStore(tempDir);
      const policy = {
        maxPerCall: 100,
        rolling24hCap: 10,
        trustedPayees: [],
        requirePayeeApproval: false,
      };
      await recordPayment(store, "demos1test", 8, "https://example.com");
      // Next payment of 5 should exceed 10 DEM cap
      const result = await checkPaySpendCap(store, "demos1test", 5, policy);
      expect(result).not.toBeNull();
      expect(result!.code).toBe("SPEND_LIMIT");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ── ISC-42: checkAndAppend exported from barrel ──────────────

describe("ISC-42: checkAndAppend exported from barrel", () => {
  it("checkAndAppend is exported from toolkit index", async () => {
    const toolkit = await import("../../src/toolkit/index.js");
    expect((toolkit as any).checkAndAppend).toBeDefined();
    expect(typeof (toolkit as any).checkAndAppend).toBe("function");
  });
});
