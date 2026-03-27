/**
 * Tests for discoverSources() — catalog browsing, filtering, sorting.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DemosSession } from "../../../src/toolkit/session.js";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import { discoverSources } from "../../../src/toolkit/tools/discover-sources.js";

function createTestSession(tempDir: string, overrides?: Partial<ConstructorParameters<typeof DemosSession>[0]>) {
  return new DemosSession({
    walletAddress: "demos1discover",
    rpcUrl: "https://demosnode.discus.sh",
    algorithm: "falcon",
    authToken: "test-token",
    signingHandle: {},
    stateStore: new FileStateStore(tempDir),
    ...overrides,
  });
}

describe("discoverSources()", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), "demos-discover-test-")); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("returns sources filtered by domain", async () => {
    const catalogPath = join(tempDir, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify([
      { id: "s1", name: "CoinGecko", domain: "crypto", url: "https://coingecko.com", status: "active", healthScore: 90 },
      { id: "s2", name: "BLS", domain: "macro", url: "https://bls.gov", status: "active", healthScore: 85 },
      { id: "s3", name: "Binance", domain: "crypto", url: "https://binance.com", status: "active", healthScore: 80 },
    ]));

    const session = createTestSession(tempDir, { sourceCatalogPath: catalogPath });
    const result = await discoverSources(session, { domain: "crypto" });

    expect(result.ok).toBe(true);
    expect(result.data!.sources).toHaveLength(2);
    expect(result.data!.sources.every(s => s.domain === "crypto")).toBe(true);
  });

  it("excludes quarantined, stale, deprecated, and archived sources", async () => {
    const catalogPath = join(tempDir, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify([
      { id: "s1", domain: "crypto", url: "https://a.com", status: "active", healthScore: 90 },
      { id: "s2", domain: "crypto", url: "https://b.com", status: "quarantined" },
      { id: "s3", domain: "crypto", url: "https://c.com", status: "stale" },
      { id: "s4", domain: "crypto", url: "https://d.com", status: "deprecated" },
      { id: "s5", domain: "crypto", url: "https://e.com", status: "archived" },
      { id: "s6", domain: "crypto", url: "https://f.com", status: "degraded", healthScore: 60 },
    ]));

    const session = createTestSession(tempDir, { sourceCatalogPath: catalogPath });
    const result = await discoverSources(session);

    expect(result.ok).toBe(true);
    expect(result.data!.sources).toHaveLength(2);
    expect(result.data!.sources.map(s => s.id)).toEqual(["s1", "s6"]);
  });

  it("sorts by healthScore descending", async () => {
    const catalogPath = join(tempDir, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify([
      { id: "low", domain: "crypto", url: "https://low.com", status: "active", healthScore: 40 },
      { id: "high", domain: "crypto", url: "https://high.com", status: "active", healthScore: 95 },
      { id: "mid", domain: "crypto", url: "https://mid.com", status: "active", healthScore: 70 },
    ]));

    const session = createTestSession(tempDir, { sourceCatalogPath: catalogPath });
    const result = await discoverSources(session);

    expect(result.ok).toBe(true);
    const ids = result.data!.sources.map(s => s.id);
    expect(ids).toEqual(["high", "mid", "low"]);
  });

  it("handles missing catalog gracefully", async () => {
    const session = createTestSession(tempDir, { sourceCatalogPath: "/tmp/nonexistent-catalog.json" });
    const result = await discoverSources(session);

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("NETWORK_ERROR");
    expect(result.error!.message).toContain("discoverSources failed");
  });

  it("returns all domains when no domain filter specified", async () => {
    const catalogPath = join(tempDir, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify([
      { id: "s1", domain: "crypto", url: "https://a.com", status: "active" },
      { id: "s2", domain: "macro", url: "https://b.com", status: "active" },
      { id: "s3", domain: "social", url: "https://c.com", status: "active" },
    ]));

    const session = createTestSession(tempDir, { sourceCatalogPath: catalogPath });
    const result = await discoverSources(session);

    expect(result.ok).toBe(true);
    expect(result.data!.sources).toHaveLength(3);
  });

  it("uses withToolWrapper for timing and onToolCall", async () => {
    const catalogPath = join(tempDir, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify([
      { id: "s1", domain: "crypto", url: "https://a.com", status: "active" },
    ]));

    const calls: string[] = [];
    const session = createTestSession(tempDir, {
      sourceCatalogPath: catalogPath,
      onToolCall: (event) => { calls.push(event.tool); },
    });

    const result = await discoverSources(session);

    expect(result.ok).toBe(true);
    expect(calls).toContain("discoverSources");
  });
});
