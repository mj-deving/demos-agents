/**
 * TDD tests for Zod input validation schemas.
 *
 * Covers: validateInput helper, all 9 tool input schemas + 2 policy schemas.
 * Tests run BEFORE implementation (red phase).
 */

import { describe, it, expect } from "vitest";
import {
  validateInput,
  ConnectOptionsSchema,
  PublishDraftSchema,
  ReplyOptionsSchema,
  ReactOptionsSchema,
  TipOptionsSchema,
  ScanOptionsSchema,
  VerifyOptionsSchema,
  AttestOptionsSchema,
  DiscoverSourcesOptionsSchema,
  PayOptionsSchema,
  TipPolicySchema,
  PayPolicySchema,
} from "../../src/toolkit/schemas.js";

// ── validateInput helper ──────────────────────────────

describe("validateInput()", () => {
  it("returns null for valid input", () => {
    const result = validateInput(ReactOptionsSchema, { txHash: "abc123", type: "agree" });
    expect(result).toBeNull();
  });

  it("returns DemosError with INVALID_INPUT code", () => {
    const result = validateInput(ReactOptionsSchema, { txHash: "", type: "agree" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("includes field path in error message", () => {
    const result = validateInput(ReactOptionsSchema, { txHash: "abc", type: "invalid" });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("type");
  });

  it("joins multiple issues with semicolon", () => {
    const result = validateInput(ReactOptionsSchema, { txHash: "", type: "invalid" });
    expect(result).not.toBeNull();
    expect(result!.message).toContain(";");
  });

  it("sets retryable to false", () => {
    const result = validateInput(ReactOptionsSchema, {});
    expect(result).not.toBeNull();
    expect(result!.retryable).toBe(false);
  });

  it("handles nested object validation errors", () => {
    const result = validateInput(ConnectOptionsSchema, {
      walletPath: "/tmp/wallet",
      tipPolicy: { maxPerTip: "not-a-number" },
    });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("tipPolicy");
  });
});

// ── ConnectOptionsSchema ──────────────────────────────

describe("ConnectOptionsSchema", () => {
  it("accepts minimal valid input (walletPath only)", () => {
    const result = validateInput(ConnectOptionsSchema, { walletPath: "/tmp/wallet.json" });
    expect(result).toBeNull();
  });

  it("accepts full valid input with all optional fields", () => {
    const result = validateInput(ConnectOptionsSchema, {
      walletPath: "/tmp/wallet.json",
      rpcUrl: "https://demosnode.discus.sh",
      algorithm: "falcon",
      skillDojoFallback: true,
      preferredPath: "local",
      stateStore: { get: () => {}, set: () => {}, lock: () => {} },
      onToolCall: () => {},
      tipPolicy: { maxPerTip: 10, maxPerPost: 5, cooldownMs: 60000 },
      payPolicy: { maxPerCall: 100, rolling24hCap: 500 },
      urlAllowlist: ["https://api.example.com"],
      allowInsecureUrls: false,
      sourceCatalogPath: "/tmp/catalog.json",
      specsDir: "/tmp/specs",
      entityMaps: { assets: { BTC: "bitcoin" }, macro: { GDP: "gdp" } },
    });
    expect(result).toBeNull();
  });

  it("rejects missing walletPath", () => {
    const result = validateInput(ConnectOptionsSchema, {});
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects empty walletPath", () => {
    const result = validateInput(ConnectOptionsSchema, { walletPath: "" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects whitespace-only walletPath", () => {
    const result = validateInput(ConnectOptionsSchema, { walletPath: "   " });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("accepts rpcUrl as valid URL string", () => {
    const result = validateInput(ConnectOptionsSchema, {
      walletPath: "/tmp/wallet",
      rpcUrl: "https://node.example.com",
    });
    expect(result).toBeNull();
  });

  it("rejects invalid rpcUrl format", () => {
    const result = validateInput(ConnectOptionsSchema, {
      walletPath: "/tmp/wallet",
      rpcUrl: "not-a-url",
    });
    expect(result).not.toBeNull();
  });

  it("accepts valid algorithm enum values", () => {
    for (const algo of ["falcon", "ml-dsa", "ed25519"]) {
      const result = validateInput(ConnectOptionsSchema, {
        walletPath: "/tmp/wallet",
        algorithm: algo,
      });
      expect(result).toBeNull();
    }
  });

  it("rejects invalid algorithm", () => {
    const result = validateInput(ConnectOptionsSchema, {
      walletPath: "/tmp/wallet",
      algorithm: "rsa",
    });
    expect(result).not.toBeNull();
  });

  it("passes through stateStore (z.any)", () => {
    const result = validateInput(ConnectOptionsSchema, {
      walletPath: "/tmp/wallet",
      stateStore: { anything: "goes" },
    });
    expect(result).toBeNull();
  });

  it("passes through onToolCall (z.any)", () => {
    const result = validateInput(ConnectOptionsSchema, {
      walletPath: "/tmp/wallet",
      onToolCall: "not-even-a-function",
    });
    expect(result).toBeNull();
  });
});

// ── TipPolicySchema ───────────────────────────────────

describe("TipPolicySchema", () => {
  it("accepts valid policy", () => {
    const result = validateInput(TipPolicySchema, { maxPerTip: 10, maxPerPost: 5, cooldownMs: 60000 });
    expect(result).toBeNull();
  });

  it("accepts empty object", () => {
    const result = validateInput(TipPolicySchema, {});
    expect(result).toBeNull();
  });

  it("rejects unknown keys (strict mode)", () => {
    const result = validateInput(TipPolicySchema, { maxPerTip: 10, unknownKey: true });
    expect(result).not.toBeNull();
  });
});

// ── PayPolicySchema ───────────────────────────────────

describe("PayPolicySchema", () => {
  it("accepts valid policy", () => {
    const result = validateInput(PayPolicySchema, { maxPerCall: 100, rolling24hCap: 500 });
    expect(result).toBeNull();
  });

  it("rejects unknown keys (strict mode)", () => {
    const result = validateInput(PayPolicySchema, { maxPerCall: 100, extraField: "oops" });
    expect(result).not.toBeNull();
  });
});

// ── PublishDraftSchema ────────────────────────────────

describe("PublishDraftSchema", () => {
  it("accepts valid draft with text, category, and attestUrl", () => {
    const result = validateInput(PublishDraftSchema, { text: "Test post", category: "ANALYSIS", attestUrl: "https://api.example.com/data" });
    expect(result).toBeNull();
  });

  it("rejects empty text", () => {
    const result = validateInput(PublishDraftSchema, { text: "", category: "ANALYSIS", attestUrl: "https://api.example.com/data" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects whitespace-only text", () => {
    const result = validateInput(PublishDraftSchema, { text: "   ", category: "ANALYSIS", attestUrl: "https://api.example.com/data" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects text exceeding 10KB", () => {
    const bigText = "x".repeat(10241);
    const result = validateInput(PublishDraftSchema, { text: bigText, category: "ANALYSIS", attestUrl: "https://api.example.com/data" });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("10KB");
  });

  it("accepts text at exactly 10KB boundary", () => {
    const maxText = "x".repeat(10240);
    const result = validateInput(PublishDraftSchema, { text: maxText, category: "ANALYSIS", attestUrl: "https://api.example.com/data" });
    expect(result).toBeNull();
  });

  it("rejects missing category", () => {
    const result = validateInput(PublishDraftSchema, { text: "Hello", attestUrl: "https://api.example.com/data" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects empty category", () => {
    const result = validateInput(PublishDraftSchema, { text: "Hello", category: "", attestUrl: "https://api.example.com/data" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("accepts optional tags array", () => {
    const result = validateInput(PublishDraftSchema, {
      text: "Hello", category: "ANALYSIS", attestUrl: "https://api.example.com/data", tags: ["crypto", "btc"],
    });
    expect(result).toBeNull();
  });

  it("accepts confidence in 0-100 range", () => {
    const result = validateInput(PublishDraftSchema, {
      text: "Hello", category: "ANALYSIS", attestUrl: "https://api.example.com/data", confidence: 80,
    });
    expect(result).toBeNull();
  });

  it("rejects confidence > 100", () => {
    const result = validateInput(PublishDraftSchema, {
      text: "Hello", category: "ANALYSIS", attestUrl: "https://api.example.com/data", confidence: 101,
    });
    expect(result).not.toBeNull();
  });

  it("rejects confidence < 0", () => {
    const result = validateInput(PublishDraftSchema, {
      text: "Hello", category: "ANALYSIS", attestUrl: "https://api.example.com/data", confidence: -1,
    });
    expect(result).not.toBeNull();
  });

  it("accepts confidence at boundary 0", () => {
    const result = validateInput(PublishDraftSchema, {
      text: "Hello", category: "ANALYSIS", attestUrl: "https://api.example.com/data", confidence: 0,
    });
    expect(result).toBeNull();
  });

  it("requires attestUrl (not optional)", () => {
    const result = validateInput(PublishDraftSchema, {
      text: "Hello", category: "ANALYSIS",
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
    expect(result!.message).toContain("attestUrl");
  });
});

// ── ReplyOptionsSchema ────────────────────────────────

describe("ReplyOptionsSchema", () => {
  it("accepts valid reply", () => {
    const result = validateInput(ReplyOptionsSchema, { parentTxHash: "abc123", text: "Great post", attestUrl: "https://api.example.com/data" });
    expect(result).toBeNull();
  });

  it("rejects empty parentTxHash", () => {
    const result = validateInput(ReplyOptionsSchema, { parentTxHash: "", text: "Great post", attestUrl: "https://api.example.com/data" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects empty text", () => {
    const result = validateInput(ReplyOptionsSchema, { parentTxHash: "abc123", text: "", attestUrl: "https://api.example.com/data" });
    expect(result).not.toBeNull();
  });

  it("rejects whitespace-only parentTxHash", () => {
    const result = validateInput(ReplyOptionsSchema, { parentTxHash: "   ", text: "Reply", attestUrl: "https://api.example.com/data" });
    expect(result).not.toBeNull();
  });
});

// ── ReactOptionsSchema ────────────────────────────────

describe("ReactOptionsSchema", () => {
  it("accepts {txHash, type: 'agree'}", () => {
    const result = validateInput(ReactOptionsSchema, { txHash: "abc123", type: "agree" });
    expect(result).toBeNull();
  });

  it("accepts {txHash, type: 'disagree'}", () => {
    const result = validateInput(ReactOptionsSchema, { txHash: "abc123", type: "disagree" });
    expect(result).toBeNull();
  });

  it("rejects empty txHash", () => {
    const result = validateInput(ReactOptionsSchema, { txHash: "", type: "agree" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects invalid type enum", () => {
    const result = validateInput(ReactOptionsSchema, { txHash: "abc123", type: "like" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects whitespace-only txHash", () => {
    const result = validateInput(ReactOptionsSchema, { txHash: "  ", type: "agree" });
    expect(result).not.toBeNull();
  });
});

// ── TipOptionsSchema ──────────────────────────────────

describe("TipOptionsSchema", () => {
  it("accepts valid {txHash, amount}", () => {
    const result = validateInput(TipOptionsSchema, { txHash: "abc123", amount: 5 });
    expect(result).toBeNull();
  });

  it("rejects empty txHash", () => {
    const result = validateInput(TipOptionsSchema, { txHash: "", amount: 5 });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects NaN amount", () => {
    const result = validateInput(TipOptionsSchema, { txHash: "abc123", amount: NaN });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("positive finite number");
  });

  it("rejects 0 amount", () => {
    const result = validateInput(TipOptionsSchema, { txHash: "abc123", amount: 0 });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("positive finite number");
  });

  it("rejects negative amount", () => {
    const result = validateInput(TipOptionsSchema, { txHash: "abc123", amount: -5 });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("positive finite number");
  });

  it("rejects Infinity amount", () => {
    const result = validateInput(TipOptionsSchema, { txHash: "abc123", amount: Infinity });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("positive finite number");
  });
});

// ── ScanOptionsSchema ─────────────────────────────────

describe("ScanOptionsSchema", () => {
  it("accepts undefined (whole schema is optional)", () => {
    const result = validateInput(ScanOptionsSchema, undefined);
    expect(result).toBeNull();
  });

  it("accepts empty object", () => {
    const result = validateInput(ScanOptionsSchema, {});
    expect(result).toBeNull();
  });

  it("accepts valid domain and limit", () => {
    const result = validateInput(ScanOptionsSchema, { domain: "crypto", limit: 20 });
    expect(result).toBeNull();
  });

  it("rejects non-integer limit", () => {
    const result = validateInput(ScanOptionsSchema, { limit: 1.5 });
    expect(result).not.toBeNull();
  });

  it("rejects limit <= 0", () => {
    const result = validateInput(ScanOptionsSchema, { limit: 0 });
    expect(result).not.toBeNull();
  });

  it("accepts large limit (no upper cap)", () => {
    const result = validateInput(ScanOptionsSchema, { limit: 1000 });
    expect(result).toBeNull();
  });

  it("rejects null (must not bypass validation)", () => {
    const result = validateInput(ScanOptionsSchema, null);
    expect(result).not.toBeNull();
  });
});

// ── VerifyOptionsSchema ───────────────────────────────

describe("VerifyOptionsSchema", () => {
  it("accepts valid txHash", () => {
    const result = validateInput(VerifyOptionsSchema, { txHash: "abc123" });
    expect(result).toBeNull();
  });

  it("rejects empty txHash", () => {
    const result = validateInput(VerifyOptionsSchema, { txHash: "" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects whitespace-only txHash", () => {
    const result = validateInput(VerifyOptionsSchema, { txHash: "   " });
    expect(result).not.toBeNull();
  });
});

// ── AttestOptionsSchema ───────────────────────────────

describe("AttestOptionsSchema", () => {
  it("accepts valid URL string", () => {
    const result = validateInput(AttestOptionsSchema, { url: "https://api.example.com/data" });
    expect(result).toBeNull();
  });

  it("rejects empty url", () => {
    const result = validateInput(AttestOptionsSchema, { url: "" });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects whitespace-only url", () => {
    const result = validateInput(AttestOptionsSchema, { url: "   " });
    expect(result).not.toBeNull();
  });

  it("accepts optional claimType", () => {
    const result = validateInput(AttestOptionsSchema, { url: "https://example.com", claimType: "price" });
    expect(result).toBeNull();
  });
});

// ── DiscoverSourcesOptionsSchema ──────────────────────

describe("DiscoverSourcesOptionsSchema", () => {
  it("accepts undefined", () => {
    const result = validateInput(DiscoverSourcesOptionsSchema, undefined);
    expect(result).toBeNull();
  });

  it("accepts valid matchThreshold between 0 and 1", () => {
    const result = validateInput(DiscoverSourcesOptionsSchema, { matchThreshold: 0.5 });
    expect(result).toBeNull();
  });

  it("rejects matchThreshold > 1", () => {
    const result = validateInput(DiscoverSourcesOptionsSchema, { matchThreshold: 1.5 });
    expect(result).not.toBeNull();
  });

  it("rejects matchThreshold < 0", () => {
    const result = validateInput(DiscoverSourcesOptionsSchema, { matchThreshold: -0.1 });
    expect(result).not.toBeNull();
  });

  it("accepts boundary values 0 and 1", () => {
    expect(validateInput(DiscoverSourcesOptionsSchema, { matchThreshold: 0 })).toBeNull();
    expect(validateInput(DiscoverSourcesOptionsSchema, { matchThreshold: 1 })).toBeNull();
  });

  it("rejects null (must not bypass validation)", () => {
    const result = validateInput(DiscoverSourcesOptionsSchema, null);
    expect(result).not.toBeNull();
  });
});

// ── PayOptionsSchema ──────────────────────────────────

describe("PayOptionsSchema", () => {
  it("accepts valid {url, maxSpend}", () => {
    const result = validateInput(PayOptionsSchema, { url: "https://api.example.com", maxSpend: 10 });
    expect(result).toBeNull();
  });

  it("rejects empty url", () => {
    const result = validateInput(PayOptionsSchema, { url: "", maxSpend: 10 });
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_INPUT");
  });

  it("rejects 0 maxSpend", () => {
    const result = validateInput(PayOptionsSchema, { url: "https://example.com", maxSpend: 0 });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("positive finite number");
  });

  it("rejects NaN maxSpend", () => {
    const result = validateInput(PayOptionsSchema, { url: "https://example.com", maxSpend: NaN });
    expect(result).not.toBeNull();
    expect(result!.message).toContain("positive finite number");
  });

  it("rejects negative maxSpend", () => {
    const result = validateInput(PayOptionsSchema, { url: "https://example.com", maxSpend: -10 });
    expect(result).not.toBeNull();
  });

  it("rejects Infinity maxSpend", () => {
    const result = validateInput(PayOptionsSchema, { url: "https://example.com", maxSpend: Infinity });
    expect(result).not.toBeNull();
  });

  it("accepts optional headers record", () => {
    const result = validateInput(PayOptionsSchema, {
      url: "https://example.com",
      maxSpend: 10,
      headers: { Authorization: "Bearer token" },
    });
    expect(result).toBeNull();
  });

  it("accepts optional body (unknown type)", () => {
    const result = validateInput(PayOptionsSchema, {
      url: "https://example.com",
      maxSpend: 10,
      body: { nested: { deep: true } },
    });
    expect(result).toBeNull();
  });

  it("rejects whitespace-only url", () => {
    const result = validateInput(PayOptionsSchema, { url: "   ", maxSpend: 10 });
    expect(result).not.toBeNull();
  });
});
