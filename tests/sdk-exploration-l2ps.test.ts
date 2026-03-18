/**
 * SDK Exploration: L2PS (Layer 2 Private Subnets)
 *
 * Phase 0 — verify @kynesyslabs/demosdk/l2ps works at runtime.
 * All tests are offline (encryption/decryption is local, no network).
 */

import { describe, it, expect } from "vitest";
import { L2PS } from "@kynesyslabs/demosdk/l2ps";
import type { Transaction } from "@kynesyslabs/demosdk/types";

// ════════════════════════════════════════════════════
// OFFLINE TESTS (encryption is purely local)
// ════════════════════════════════════════════════════

describe("L2PS — import + offline ops", () => {
  it("imports L2PS class from SDK", () => {
    expect(L2PS).toBeDefined();
    expect(typeof L2PS.create).toBe("function");
    expect(typeof L2PS.getInstance).toBe("function");
    expect(typeof L2PS.getInstances).toBe("function");
    expect(typeof L2PS.hasInstance).toBe("function");
    expect(typeof L2PS.removeInstance).toBe("function");
  });

  it("L2PS.create() generates instance with unique ID", async () => {
    const l2ps = await L2PS.create();
    expect(l2ps).toBeDefined();
    const id = l2ps.getId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    // Cleanup
    L2PS.removeInstance(id);
  });

  it("two instances have different IDs", async () => {
    const a = await L2PS.create();
    const b = await L2PS.create();
    expect(a.getId()).not.toBe(b.getId());

    // Cleanup
    L2PS.removeInstance(a.getId());
    L2PS.removeInstance(b.getId());
  });

  it("getInstance retrieves by ID", async () => {
    const l2ps = await L2PS.create();
    const id = l2ps.getId();
    const retrieved = L2PS.getInstance(id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.getId()).toBe(id);

    L2PS.removeInstance(id);
  });

  it("hasInstance returns true for existing, false for removed", async () => {
    const l2ps = await L2PS.create();
    const id = l2ps.getId();
    expect(L2PS.hasInstance(id)).toBe(true);

    L2PS.removeInstance(id);
    expect(L2PS.hasInstance(id)).toBe(false);
  });

  it("getKeyFingerprint returns 16-char string", async () => {
    const l2ps = await L2PS.create();
    const fp = await l2ps.getKeyFingerprint();
    expect(typeof fp).toBe("string");
    expect(fp.length).toBe(16);

    L2PS.removeInstance(l2ps.getId());
  });

  // NOTE: encryptTx/decryptTx fail in Node.js — the SDK's L2PS uses
  // browser-only Buffer polyfill (l2ps.ts:240). This needs a Buffer shim
  // or the SDK needs to use Uint8Array instead. Documenting as SDK limitation.

  it("encryptTx fails with Buffer polyfill issue (SDK limitation)", async () => {
    const l2ps = await L2PS.create();

    const mockTx = {
      type: "transfer",
      sender: "demos1sender",
      recipient: "demos1recipient",
      amount: 100,
      hash: "abc123",
    } as unknown as Transaction;

    // Expected to fail — SDK uses browser Buffer
    await expect(l2ps.encryptTx(mockTx)).rejects.toThrow();

    L2PS.removeInstance(l2ps.getId());
  });

  it("encrypt→decrypt round-trip blocked by Buffer issue", async () => {
    const l2ps = await L2PS.create();

    const original = {
      type: "transfer",
      sender: "demos1sender",
      recipient: "demos1recipient",
      amount: 42,
      hash: "roundtrip-test",
    } as unknown as Transaction;

    // Expected to fail — same Buffer polyfill issue
    await expect(l2ps.encryptTx(original)).rejects.toThrow();

    L2PS.removeInstance(l2ps.getId());
  });

  it("setConfig/getConfig round-trips", async () => {
    const l2ps = await L2PS.create();
    const config = {
      uid: "test-l2ps-001",
      config: {
        created_at_block: 1000,
        known_rpcs: ["https://demosnode.discus.sh/"],
      },
    };

    l2ps.setConfig(config);
    const retrieved = l2ps.getConfig();
    expect(retrieved?.uid).toBe("test-l2ps-001");
    expect(retrieved?.config.created_at_block).toBe(1000);

    L2PS.removeInstance(l2ps.getId());
  });

  it("getInstances returns all active instances", async () => {
    const before = L2PS.getInstances().length;
    const a = await L2PS.create();
    const b = await L2PS.create();
    expect(L2PS.getInstances().length).toBe(before + 2);

    L2PS.removeInstance(a.getId());
    L2PS.removeInstance(b.getId());
    expect(L2PS.getInstances().length).toBe(before);
  });
});
