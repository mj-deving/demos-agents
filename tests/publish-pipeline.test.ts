/**
 * Tests for publish-pipeline — DAHR attestation, HIVE encoding, publish flow.
 *
 * Tests the core publish pipeline with fully mocked SDK and API.
 * Covers: encodeHivePost, attestDahr guardrails, publishPost tx extraction,
 * attestAndPublish with pre-attested results.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK to avoid NAPI crash — SDK is incompatible with vitest
vi.mock("@kynesyslabs/demosdk/websdk", () => ({
  Demos: class {},
  DemosTransactions: {
    store: vi.fn().mockResolvedValue({ tx: "mock" }),
    confirm: vi.fn().mockResolvedValue({
      response: { data: { transaction: { hash: "mock-tx-hash" } } },
    }),
    broadcast: vi.fn().mockResolvedValue({ response: { results: {} } }),
  },
}));

const {
  attestDahr,
  publishPost,
  attestAndPublish,
} = await import("../src/actions/publish-pipeline.js");
import type { PublishInput, AttestResult } from "../src/actions/publish-pipeline.js";

// ── Mock SDK ────────────────────────────────────────

function makeMockDemos(overrides: Record<string, unknown> = {}) {
  return {
    web2: {
      createDahr: vi.fn().mockResolvedValue({
        startProxy: vi.fn().mockResolvedValue({
          responseHash: "hash-abc",
          txHash: "dahr-tx-123",
          data: JSON.stringify({ result: "ok" }),
        }),
      }),
    },
    sendTransaction: vi.fn(),
    ...overrides,
  } as any;
}

const validInput: PublishInput = {
  text: "Test post about BTC analysis with sufficient length for quality checks",
  category: "ANALYSIS",
  tags: ["btc", "test"],
  confidence: 75,
  sourceAttestations: [
    { url: "https://example.com/data", responseHash: "hash-1", txHash: "dahr-tx-1" },
  ],
};

// ── attestDahr ──────────────────────────────────────

describe("attestDahr", () => {
  it("returns AttestResult with correct shape", async () => {
    const demos = makeMockDemos();
    const result = await attestDahr(demos, "https://api.example.com/data");

    expect(result.type).toBe("dahr");
    expect(result.url).toBe("https://api.example.com/data");
    expect(result.requestedUrl).toBe("https://api.example.com/data");
    expect(result.responseHash).toBe("hash-abc");
    expect(result.txHash).toBe("dahr-tx-123");
    expect(result.data).toBeDefined();
  });

  it("rejects non-2xx HTTP status from upstream", async () => {
    const demos = makeMockDemos();
    demos.web2.createDahr.mockResolvedValue({
      startProxy: vi.fn().mockResolvedValue({
        status: 401,
        responseHash: "hash",
        txHash: "tx",
        data: '{"error":"Unauthorized"}',
      }),
    });

    await expect(attestDahr(demos, "https://api.example.com/data")).rejects.toThrow(
      /HTTP 401/,
    );
  });

  it("rejects XML/HTML responses", async () => {
    const demos = makeMockDemos();
    demos.web2.createDahr.mockResolvedValue({
      startProxy: vi.fn().mockResolvedValue({
        responseHash: "hash",
        txHash: "tx",
        data: "<html><body>Not found</body></html>",
      }),
    });

    await expect(attestDahr(demos, "https://api.example.com/data")).rejects.toThrow(
      /XML\/HTML/,
    );
  });

  it("rejects auth error payloads in JSON body", async () => {
    const demos = makeMockDemos();
    demos.web2.createDahr.mockResolvedValue({
      startProxy: vi.fn().mockResolvedValue({
        responseHash: "hash",
        txHash: "tx",
        data: JSON.stringify({ error: "Unauthorized" }),
      }),
    });

    await expect(attestDahr(demos, "https://api.example.com/data")).rejects.toThrow(
      /error payload/,
    );
  });

  it("accepts valid non-auth error fields in JSON body", async () => {
    const demos = makeMockDemos();
    demos.web2.createDahr.mockResolvedValue({
      startProxy: vi.fn().mockResolvedValue({
        responseHash: "hash",
        txHash: "tx",
        data: JSON.stringify({ error: "No data available for this date" }),
      }),
    });

    // "No data available" is not an auth error — should succeed
    const result = await attestDahr(demos, "https://api.example.com/data");
    expect(result.txHash).toBe("tx");
  });

  it("handles non-JSON string data", async () => {
    const demos = makeMockDemos();
    demos.web2.createDahr.mockResolvedValue({
      startProxy: vi.fn().mockResolvedValue({
        responseHash: "hash",
        txHash: "tx",
        data: "not json at all {",
      }),
    });

    await expect(attestDahr(demos, "https://api.example.com/data")).rejects.toThrow(
      /non-JSON/,
    );
  });
});

// ── publishPost ─────────────────────────────────────

describe("publishPost", () => {
  it("rejects unattested publish", async () => {
    const demos = makeMockDemos();
    const input: PublishInput = {
      ...validInput,
      sourceAttestations: undefined,
      tlsnAttestations: undefined,
    };

    await expect(publishPost(demos, input)).rejects.toThrow(/unattested/i);
  });

  it("rejects invalid sourceAttestations entries", async () => {
    const demos = makeMockDemos();
    const input: PublishInput = {
      ...validInput,
      sourceAttestations: [{ url: "", responseHash: "", txHash: "" }],
    };

    await expect(publishPost(demos, input)).rejects.toThrow(/invalid sourceAttestations/);
  });

  it("requires txHash, url, and responseHash on attestations", async () => {
    const demos = makeMockDemos();
    const input: PublishInput = {
      ...validInput,
      sourceAttestations: [
        { url: "https://example.com", responseHash: "h", txHash: "" },
      ],
    };

    await expect(publishPost(demos, input)).rejects.toThrow(/invalid sourceAttestations/);
  });
});

// ── attestAndPublish ────────────────────────────────

describe("attestAndPublish", () => {
  it("uses pre-attested results and publishes successfully", async () => {
    const mockDemos = {
      web2: { createDahr: vi.fn() },
      sendTransaction: vi.fn(),
    } as any;

    const preAttested: AttestResult[] = [
      {
        type: "dahr",
        url: "https://api.example.com",
        requestedUrl: "https://api.example.com",
        responseHash: "hash-pre",
        txHash: "tx-pre",
        data: { result: "ok" },
      },
    ];

    const result = await attestAndPublish(mockDemos, validInput, undefined, {
      preAttested,
      skipIndexerCheck: true,
    });

    // Should NOT have called createDahr since we had pre-attested results
    expect(mockDemos.web2.createDahr).not.toHaveBeenCalled();
    // Should have published successfully with a txHash
    expect(result.txHash).toBe("mock-tx-hash");
    expect(result.attestation).toBeDefined();
    expect(result.attestation!.txHash).toBe("tx-pre");
  });
});
