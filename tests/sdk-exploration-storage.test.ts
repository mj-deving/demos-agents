/**
 * SDK Exploration: StorageProgram
 *
 * Phase 0 — verify @kynesyslabs/demosdk/storage works at runtime.
 * Offline tests (no network) validate imports, payload creation, ACL.
 * Live tests (DEMOS_LIVE=1) validate on-chain CRUD.
 */

import { describe, it, expect } from "vitest";
import {
  StorageProgram,
  type StorageProgramData,
  type StorageProgramListItem,
} from "@kynesyslabs/demosdk/storage";

const LIVE = process.env.DEMOS_LIVE === "1";
const RPC_URL = "https://demosnode.discus.sh/";
const TEST_ADDRESS = "demos1test_exploration_" + Date.now();

// ════════════════════════════════════════════════════
// OFFLINE TESTS (no network required)
// ════════════════════════════════════════════════════

describe("StorageProgram — import + offline ops", () => {
  it("imports StorageProgram class from SDK", () => {
    expect(StorageProgram).toBeDefined();
    expect(typeof StorageProgram.deriveStorageAddress).toBe("function");
    expect(typeof StorageProgram.createStorageProgram).toBe("function");
    expect(typeof StorageProgram.writeStorage).toBe("function");
    expect(typeof StorageProgram.readStorage).toBe("function");
    expect(typeof StorageProgram.setField).toBe("function");
    expect(typeof StorageProgram.appendItem).toBe("function");
    expect(typeof StorageProgram.deleteField).toBe("function");
    expect(typeof StorageProgram.validateSize).toBe("function");
    expect(typeof StorageProgram.calculateStorageFee).toBe("function");
  });

  it("deriveStorageAddress returns stor- prefixed address", () => {
    const addr = StorageProgram.deriveStorageAddress(
      "demos1abc123",
      "test-program",
      42,
    );
    expect(addr).toMatch(/^stor-/);
    expect(addr.length).toBeGreaterThan(5);
  });

  it("deriveStorageAddress is deterministic", () => {
    const a = StorageProgram.deriveStorageAddress("demos1x", "prog", 1);
    const b = StorageProgram.deriveStorageAddress("demos1x", "prog", 1);
    expect(a).toBe(b);
  });

  it("deriveStorageAddress varies with nonce", () => {
    const a = StorageProgram.deriveStorageAddress("demos1x", "prog", 1);
    const b = StorageProgram.deriveStorageAddress("demos1x", "prog", 2);
    expect(a).not.toBe(b);
  });

  it("createStorageProgram produces valid payload", () => {
    const payload = StorageProgram.createStorageProgram(
      "demos1deployer",
      "agent-state",
      { agent: "nexus", version: "1.0", state: {} },
      "json",
      { mode: "public" },
      { nonce: 1 },
    );
    expect(payload).toBeDefined();
    expect(typeof payload).toBe("object");
  });

  it("writeStorage produces valid payload", () => {
    const payload = StorageProgram.writeStorage(
      "stor-abc123",
      { key: "value", nested: { a: 1 } },
      "json",
    );
    expect(payload).toBeDefined();
  });

  it("readStorage produces valid payload", () => {
    const payload = StorageProgram.readStorage("stor-abc123");
    expect(payload).toBeDefined();
  });

  it("setField produces valid payload", () => {
    const payload = StorageProgram.setField("stor-abc123", "status", "active");
    expect(payload).toBeDefined();
  });

  it("appendItem produces valid payload", () => {
    const payload = StorageProgram.appendItem("stor-abc123", "log", {
      ts: Date.now(),
      msg: "test",
    });
    expect(payload).toBeDefined();
  });

  it("deleteField produces valid payload", () => {
    const payload = StorageProgram.deleteField("stor-abc123", "obsolete");
    expect(payload).toBeDefined();
  });

  it("validateSize returns true for small JSON", () => {
    const ok = StorageProgram.validateSize({ key: "value" }, "json");
    expect(ok).toBe(true);
  });

  it("validateSize returns false for oversized data", () => {
    // 1MB limit — create string larger than 1MB
    const huge = { data: "x".repeat(1_100_000) };
    const ok = StorageProgram.validateSize(huge, "json");
    expect(ok).toBe(false);
  });

  it("calculateStorageFee returns bigint", () => {
    const fee = StorageProgram.calculateStorageFee({ key: "value" }, "json");
    expect(typeof fee).toBe("bigint");
    expect(fee).toBeGreaterThanOrEqual(1n); // minimum 1 DEM
  });

  it("calculateStorageFee scales with data size", () => {
    const small = StorageProgram.calculateStorageFee({ a: "b" }, "json");
    const large = StorageProgram.calculateStorageFee(
      { data: "x".repeat(50_000) },
      "json",
    );
    expect(large).toBeGreaterThan(small);
  });

  it("publicACL returns public mode", () => {
    const acl = StorageProgram.publicACL();
    expect(acl.mode).toBe("public");
  });

  it("privateACL returns owner mode", () => {
    const acl = StorageProgram.privateACL();
    expect(acl.mode).toBe("owner");
  });

  it("restrictedACL includes allowed addresses", () => {
    const acl = StorageProgram.restrictedACL(["demos1a", "demos1b"]);
    expect(acl.mode).toBe("restricted");
    expect(acl.allowed).toContain("demos1a");
  });

  it("groupACL supports named groups", () => {
    const acl = StorageProgram.groupACL({
      admins: {
        members: ["demos1admin"],
        permissions: ["read", "write", "delete"],
      },
      viewers: { members: ["demos1view"], permissions: ["read"] },
    });
    expect(acl.mode).toBe("restricted");
    expect(acl.groups).toBeDefined();
  });

  it("checkPermission grants owner full access", () => {
    const acl = StorageProgram.privateACL();
    const allowed = StorageProgram.checkPermission(
      acl,
      "demos1owner",
      "demos1owner",
      "write",
    );
    expect(allowed).toBe(true);
  });

  it("checkPermission denies non-owner on private", () => {
    const acl = StorageProgram.privateACL();
    const allowed = StorageProgram.checkPermission(
      acl,
      "demos1owner",
      "demos1other",
      "read",
    );
    expect(allowed).toBe(false);
  });

  it("validateNestingDepth accepts shallow objects", () => {
    const ok = StorageProgram.validateNestingDepth({ a: { b: { c: 1 } } });
    expect(ok).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// LIVE TESTS (require DEMOS_LIVE=1 + credentials)
// ════════════════════════════════════════════════════

describe.skipIf(!LIVE)("StorageProgram — live network", () => {
  it("getByOwner returns array (may be empty)", async () => {
    const result = await StorageProgram.getByOwner(
      RPC_URL,
      "0x6a1104179536c23247730e3905cee5f68db432d67ec16c2db8a0d611b3b5554b",
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("searchByName returns array", async () => {
    const result = await StorageProgram.searchByName(RPC_URL, "test", {
      limit: 5,
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it("getByAddress returns null for nonexistent", async () => {
    const result = await StorageProgram.getByAddress(
      RPC_URL,
      "stor-nonexistent000000000000000000000000",
    );
    expect(result).toBeNull();
  });
});
