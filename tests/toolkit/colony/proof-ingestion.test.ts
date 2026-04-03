import { describe, expect, it, beforeEach } from "vitest";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { initColonyCache, type ColonyDatabase } from "../../../src/toolkit/colony/schema.js";
import { ingestProofs } from "../../../src/toolkit/colony/proof-ingestion.js";
import type { ChainReaderRpc } from "../../../src/toolkit/chain-reader.js";

let db: ColonyDatabase;
let tempDir: string;

function insertTestAttestation(
  db: ColonyDatabase,
  overrides: Partial<{
    id: number;
    post_tx_hash: string;
    attestation_tx_hash: string;
    source_url: string;
    method: string;
    data_snapshot: string | null;
    attested_at: string;
    chain_verified: number;
  }> = {},
): void {
  // Insert a dummy post first (FK constraint)
  const postHash = overrides.post_tx_hash ?? `post_${Date.now()}_${Math.random()}`;
  db.prepare(`
    INSERT OR IGNORE INTO posts (tx_hash, author, block_number, timestamp, text, raw_data)
    VALUES (?, 'agent1', 100, '2026-04-01T00:00:00Z', 'test post', '{}')
  `).run(postHash);

  db.prepare(`
    INSERT INTO attestations (post_tx_hash, attestation_tx_hash, source_url, method, data_snapshot, attested_at, chain_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    postHash,
    overrides.attestation_tx_hash ?? "0xattest_default",
    overrides.source_url ?? "https://api.example.com",
    overrides.method ?? "DAHR",
    overrides.data_snapshot ?? '{"price": 65000}',
    overrides.attested_at ?? "2026-04-01T00:00:00Z",
    overrides.chain_verified ?? 0,
  );
}

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), "proof-ingestion-"));
  db = initColonyCache(resolve(tempDir, "test.db"));
});

describe("ingestProofs", () => {
  it("resolves unverified DAHR attestations and marks as verified", async () => {
    insertTestAttestation(db, {
      attestation_tx_hash: "0xdahr1",
      data_snapshot: '{"price": 65000}',
    });

    const rpc: ChainReaderRpc = {
      getTxByHash: async () => ({
        hash: "0xdahr1",
        blockNumber: 100,
        status: "confirmed",
        content: {
          from: "0xnode",
          to: "0xagent",
          type: "web2",
          data: { url: "https://api.example.com", responseHash: "hash123" },
          timestamp: 1700000000,
        },
      }),
    };

    const result = await ingestProofs(db, rpc);

    expect(result.verified).toBe(1);
    expect(result.resolved).toBe(1);
    expect(result.failed).toBe(0);

    // Check DB was updated
    const row = db.prepare("SELECT chain_verified, chain_method, resolved_at FROM attestations WHERE attestation_tx_hash = ?")
      .get("0xdahr1") as { chain_verified: number; chain_method: string; resolved_at: string };
    expect(row.chain_verified).toBe(1);
    expect(row.chain_method).toBe("DAHR");
    expect(row.resolved_at).toBeTruthy();
  });

  it("marks permanently failed attestations as -1", async () => {
    insertTestAttestation(db, { attestation_tx_hash: "0xmissing" });

    const rpc: ChainReaderRpc = {
      getTxByHash: async () => null as never,
    };

    const result = await ingestProofs(db, rpc);

    expect(result.failed).toBe(1);
    expect(result.verified).toBe(0);

    const row = db.prepare("SELECT chain_verified FROM attestations WHERE attestation_tx_hash = ?")
      .get("0xmissing") as { chain_verified: number };
    expect(row.chain_verified).toBe(-1);
  });

  it("skips retryable failures (leaves chain_verified=0)", async () => {
    insertTestAttestation(db, { attestation_tx_hash: "0xtimeout" });

    const rpc: ChainReaderRpc = {
      getTxByHash: async () => { throw new Error("network timeout"); },
    };

    // resolveAttestation catches the throw and returns rpc_error (retryable)
    const result = await ingestProofs(db, rpc);

    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);

    // chain_verified stays 0 (retryable)
    const row = db.prepare("SELECT chain_verified FROM attestations WHERE attestation_tx_hash = ?")
      .get("0xtimeout") as { chain_verified: number };
    expect(row.chain_verified).toBe(0);
  });

  it("skips already-resolved attestations", async () => {
    insertTestAttestation(db, {
      attestation_tx_hash: "0xresolved",
      chain_verified: 1,
    });

    const rpc: ChainReaderRpc = {
      getTxByHash: async () => { throw new Error("should not be called"); },
    };

    const result = await ingestProofs(db, rpc);

    expect(result.resolved).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      insertTestAttestation(db, {
        post_tx_hash: `post_${i}`,
        attestation_tx_hash: `0xbatch_${i}`,
      });
    }

    let callCount = 0;
    const rpc: ChainReaderRpc = {
      getTxByHash: async () => {
        callCount++;
        return {
          hash: "0x",
          blockNumber: 100,
          status: "confirmed",
          content: {
            from: "0xnode",
            to: "0xagent",
            type: "web2",
            data: { url: "https://api.example.com", responseHash: "h" },
            timestamp: 1700000000,
          },
        };
      },
    };

    const result = await ingestProofs(db, rpc, { limit: 2 });

    expect(callCount).toBe(2);
    expect(result.resolved).toBe(2);
  });

  it("returns empty result when no unresolved attestations exist", async () => {
    const rpc: ChainReaderRpc = {
      getTxByHash: async () => { throw new Error("should not be called"); },
    };

    const result = await ingestProofs(db, rpc);

    expect(result).toEqual({ resolved: 0, verified: 0, failed: 0, skipped: 0 });
  });

  it("handles RPC unavailable gracefully (leaves as retryable)", async () => {
    insertTestAttestation(db, { attestation_tx_hash: "0xno-rpc" });

    const rpc: ChainReaderRpc = {};  // No getTxByHash

    const result = await ingestProofs(db, rpc);

    // rpc_unavailable is retryable, not permanent
    expect(result.skipped).toBe(1);

    const row = db.prepare("SELECT chain_verified FROM attestations WHERE attestation_tx_hash = ?")
      .get("0xno-rpc") as { chain_verified: number };
    expect(row.chain_verified).toBe(0);  // Still unresolved
  });

  it("rejects attestation when chain URL does not match claimed URL (spoofing)", async () => {
    insertTestAttestation(db, {
      attestation_tx_hash: "0xspoof",
      source_url: "https://api.coingecko.com/data",
    });

    const rpc: ChainReaderRpc = {
      getTxByHash: async () => ({
        hash: "0xspoof",
        blockNumber: 100,
        status: "confirmed",
        content: {
          from: "0xnode",
          to: "0xagent",
          type: "web2",
          data: { url: "https://api.evil.com/data", responseHash: "hash123" },
          timestamp: 1700000000,
        },
      }),
    };

    const result = await ingestProofs(db, rpc);

    expect(result.failed).toBe(1);
    expect(result.verified).toBe(0);

    const row = db.prepare("SELECT chain_verified FROM attestations WHERE attestation_tx_hash = ?")
      .get("0xspoof") as { chain_verified: number };
    expect(row.chain_verified).toBe(-1);
  });

  it("rejects attestation when chain URL embeds claimed hostname as subdomain", async () => {
    insertTestAttestation(db, {
      attestation_tx_hash: "0xsubdomain",
      source_url: "https://api.coingecko.com/data",
    });

    const rpc: ChainReaderRpc = {
      getTxByHash: async () => ({
        hash: "0xsubdomain",
        blockNumber: 100,
        status: "confirmed",
        content: {
          from: "0xnode",
          to: "0xagent",
          type: "web2",
          data: { url: "https://api.coingecko.com.evil.com/data", responseHash: "h" },
          timestamp: 1700000000,
        },
      }),
    };

    const result = await ingestProofs(db, rpc);

    expect(result.failed).toBe(1);
  });

  it("rejects attestation when claimed URL is empty (bypass attempt)", async () => {
    insertTestAttestation(db, {
      attestation_tx_hash: "0xempty-url",
      source_url: "",
    });

    const rpc: ChainReaderRpc = {
      getTxByHash: async () => ({
        hash: "0xempty-url",
        blockNumber: 100,
        status: "confirmed",
        content: {
          from: "0xnode",
          to: "0xagent",
          type: "web2",
          data: { url: "https://api.real.com", responseHash: "h" },
          timestamp: 1700000000,
        },
      }),
    };

    const result = await ingestProofs(db, rpc);

    expect(result.failed).toBe(1);
  });
});
