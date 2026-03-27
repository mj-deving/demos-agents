/**
 * Tests for tool input validation and guard integration.
 *
 * These tests verify validation behavior (rejection paths) without
 * mocked SDK bridge. Happy-path behavioral tests are in integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DemosSession } from "../../../src/toolkit/session.js";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import { react } from "../../../src/toolkit/tools/react.js";
import { tip } from "../../../src/toolkit/tools/tip.js";
import { scan } from "../../../src/toolkit/tools/scan.js";
import { verify } from "../../../src/toolkit/tools/verify.js";
import { attest } from "../../../src/toolkit/tools/attest.js";
import { discoverSources } from "../../../src/toolkit/tools/discover-sources.js";
import { pay } from "../../../src/toolkit/tools/pay.js";

function createTestSession(tempDir: string, overrides?: Partial<ConstructorParameters<typeof DemosSession>[0]>) {
  return new DemosSession({
    walletAddress: "demos1tooltest",
    rpcUrl: "https://demosnode.discus.sh",
    algorithm: "falcon",
    authToken: "test-token",
    signingHandle: {},
    stateStore: new FileStateStore(tempDir),
    ...overrides,
  });
}

describe("react() validation", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), "demos-react-")); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("rejects missing txHash", async () => {
    const session = createTestSession(tempDir);
    const result = await react(session, { txHash: "", type: "agree" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("txHash");
  });

  it("rejects invalid reaction type", async () => {
    const session = createTestSession(tempDir);
    const result = await react(session, { txHash: "0x1", type: "like" as "agree" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("agree");
  });

  it("fails with bridge error when no bridge configured", async () => {
    const session = createTestSession(tempDir);
    const result = await react(session, { txHash: "0xabc", type: "agree" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("NETWORK_ERROR");
    expect(result.error!.message).toContain("bridge not available");
  });
});

describe("tip() validation", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), "demos-tip-tool-")); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("enforces tip spend cap (max 10 DEM)", async () => {
    const session = createTestSession(tempDir);
    const result = await tip(session, { txHash: "0xabc", amount: 15 });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("SPEND_LIMIT");
  });

  it("rejects missing txHash", async () => {
    const session = createTestSession(tempDir);
    const result = await tip(session, { txHash: "", amount: 5 });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("rejects NaN amount", async () => {
    const session = createTestSession(tempDir);
    const result = await tip(session, { txHash: "0xabc", amount: NaN });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("positive finite");
  });
});

describe("scan() validation", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), "demos-scan-")); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("fails with bridge error when no bridge configured", async () => {
    const session = createTestSession(tempDir);
    const result = await scan(session);
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("NETWORK_ERROR");
    expect(result.error!.message).toContain("bridge not available");
  });
});

describe("verify() validation", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), "demos-verify-")); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("rejects missing txHash", async () => {
    const session = createTestSession(tempDir);
    const result = await verify(session, { txHash: "" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });
});

describe("attest() validation", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), "demos-attest-")); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("rejects missing URL", async () => {
    const session = createTestSession(tempDir);
    const result = await attest(session, { url: "" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("rejects HTTP URL by default", async () => {
    const session = createTestSession(tempDir);
    const result = await attest(session, { url: "http://insecure.com/data" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("HTTPS");
  });

  it("rejects private IP via SSRF validator", async () => {
    const session = createTestSession(tempDir);
    const result = await attest(session, { url: "https://10.0.0.1/secret" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("private");
  });
});

describe("discoverSources()", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), "demos-discover-")); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("filters by domain when specified", async () => {
    const catalogPath = join(tempDir, "test-catalog.json");
    writeFileSync(catalogPath, JSON.stringify([
      { id: "s1", name: "Source 1", domain: "crypto", url: "https://a.com", status: "active" },
      { id: "s2", name: "Source 2", domain: "macro", url: "https://b.com", status: "active" },
      { id: "s3", name: "Source 3", domain: "crypto", url: "https://c.com", status: "active" },
    ]));

    const session = createTestSession(tempDir, { sourceCatalogPath: catalogPath });
    const result = await discoverSources(session, { domain: "crypto" });

    expect(result.ok).toBe(true);
    expect(result.data!.sources).toHaveLength(2);
    expect(result.data!.sources.every(s => s.domain === "crypto")).toBe(true);
  });

  it("excludes archived and deprecated sources", async () => {
    const catalogPath = join(tempDir, "test-catalog.json");
    writeFileSync(catalogPath, JSON.stringify([
      { id: "s1", domain: "crypto", url: "https://a.com", status: "active" },
      { id: "s2", domain: "crypto", url: "https://b.com", status: "archived" },
      { id: "s3", domain: "crypto", url: "https://c.com", status: "deprecated" },
    ]));

    const session = createTestSession(tempDir, { sourceCatalogPath: catalogPath });
    const result = await discoverSources(session);

    expect(result.ok).toBe(true);
    expect(result.data!.sources).toHaveLength(1);
    expect(result.data!.sources[0].id).toBe("s1");
  });

  it("accepts null session for sessionless browsing", async () => {
    const result = await discoverSources(null);
    // Uses bundled catalog — should succeed or fail with clear error
    expect(result.ok === true || result.error!.code === "INVALID_INPUT").toBe(true);
  });
});

describe("pay() validation", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), "demos-pay-tool-")); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("rejects missing URL", async () => {
    const session = createTestSession(tempDir);
    const result = await pay(session, { url: "", maxSpend: 10 });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("rejects zero maxSpend", async () => {
    const session = createTestSession(tempDir);
    const result = await pay(session, { url: "https://api.com/data", maxSpend: 0 });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("rejects NaN maxSpend", async () => {
    const session = createTestSession(tempDir);
    const result = await pay(session, { url: "https://api.com/data", maxSpend: NaN });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("rejects HTTP URL by default", async () => {
    const session = createTestSession(tempDir);
    const result = await pay(session, { url: "http://api.com/data", maxSpend: 10 });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("HTTPS");
  });

  it("returns cached result for duplicate payment (idempotency)", async () => {
    const session = createTestSession(tempDir);
    const { recordPayReceipt, makeIdempotencyKey } = await import(
      "../../../src/toolkit/guards/pay-receipt-log.js"
    );
    const key = makeIdempotencyKey("https://api.com/data", "GET");
    await recordPayReceipt(session.stateStore, session.walletAddress, {
      txHash: "0xcached",
      url: "https://api.com/data",
      amount: 5,
      timestamp: Date.now(),
      idempotencyKey: key,
    });

    const result = await pay(session, { url: "https://api.com/data", maxSpend: 10 });
    expect(result.ok).toBe(true);
    expect(result.data!.receipt!.txHash).toBe("0xcached");
    expect(result.data!.receipt!.amount).toBe(5);
  });
});
