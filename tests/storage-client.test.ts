/**
 * Tests for storage-client — wraps StorageProgram SDK for agent use.
 *
 * All tests are offline (payload creation is local, no network I/O).
 */

import { describe, it, expect } from "vitest";
import { createStorageClient } from "../tools/lib/storage-client.js";

const client = createStorageClient({
  rpcUrl: "https://demosnode.discus.sh/",
  agentName: "nexus",
  agentAddress: "demos1test_nexus_agent",
});

// ════════════════════════════════════════════════════
// Address Derivation
// ════════════════════════════════════════════════════

describe("StorageClient — address derivation", () => {
  it("derives stor- prefixed address", () => {
    const addr = client.deriveStateAddress(1);
    expect(addr).toMatch(/^stor-/);
  });

  it("is deterministic", () => {
    const a = client.deriveStateAddress(42);
    const b = client.deriveStateAddress(42);
    expect(a).toBe(b);
  });

  it("varies with nonce", () => {
    const a = client.deriveStateAddress(1);
    const b = client.deriveStateAddress(2);
    expect(a).not.toBe(b);
  });
});

// ════════════════════════════════════════════════════
// Payload Creation
// ════════════════════════════════════════════════════

describe("StorageClient — payload creation", () => {
  it("createStatePayload produces valid object", () => {
    const payload = client.createStatePayload(
      { agent: "nexus", version: "1.0", state: {} },
      1,
      "public",
    );
    expect(payload).toBeDefined();
    expect(typeof payload).toBe("object");
  });

  it("createStatePayload with private ACL", () => {
    const payload = client.createStatePayload({ secret: true }, 2, "private");
    expect(payload).toBeDefined();
  });

  it("writeStatePayload produces valid object", () => {
    const payload = client.writeStatePayload("stor-abc", { key: "updated" });
    expect(payload).toBeDefined();
  });

  it("setFieldPayload produces valid object", () => {
    const payload = client.setFieldPayload("stor-abc", "status", "active");
    expect(payload).toBeDefined();
  });

  it("appendItemPayload produces valid object", () => {
    const payload = client.appendItemPayload("stor-abc", "log", { ts: 1, msg: "test" });
    expect(payload).toBeDefined();
  });

  it("deleteFieldPayload produces valid object", () => {
    const payload = client.deleteFieldPayload("stor-abc", "obsolete");
    expect(payload).toBeDefined();
  });
});

// ════════════════════════════════════════════════════
// Validation
// ════════════════════════════════════════════════════

describe("StorageClient — validation", () => {
  it("validateSize returns true for small data", () => {
    expect(client.validateSize({ key: "value" })).toBe(true);
  });

  it("validateSize returns false for oversized data", () => {
    expect(client.validateSize({ huge: "x".repeat(1_100_000) })).toBe(false);
  });

  it("calculateFee returns bigint", () => {
    const fee = client.calculateFee({ key: "value" });
    expect(typeof fee).toBe("bigint");
    expect(fee).toBeGreaterThanOrEqual(1n);
  });
});
