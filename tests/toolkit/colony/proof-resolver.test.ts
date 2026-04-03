import { describe, expect, it } from "vitest";

import { compareProofToSnapshot, resolveAttestation, PERMANENT_FAILURES, type DahrProof, type TlsnProof, type FailureReason } from "../../../src/toolkit/colony/proof-resolver.js";
import type { ChainReaderRpc } from "../../../src/toolkit/chain-reader.js";

function makeRpc(txResult: unknown): ChainReaderRpc {
  return {
    getTxByHash: async () => txResult as Awaited<ReturnType<NonNullable<ChainReaderRpc["getTxByHash"]>>>,
  };
}

describe("resolveAttestation", () => {
  it("resolves a DAHR attestation (web2 type)", async () => {
    const rpc = makeRpc({
      hash: "0xdahr123",
      blockNumber: 100,
      status: "confirmed",
      content: {
        from: "0xnode",
        to: "0xagent",
        type: "web2",
        data: {
          url: "https://api.example.com/data",
          responseHash: "abc123hash",
          method: "GET",
        },
        timestamp: 1700000000,
      },
    });

    const result = await resolveAttestation(rpc, "0xdahr123");

    expect(result.verified).toBe(true);
    expect(result).toMatchObject({
      verified: true,
      method: "DAHR",
      sourceUrl: "https://api.example.com/data",
      responseHash: "abc123hash",
      timestamp: 1700000000,
    });
  });

  it("resolves a TLSN attestation (storage type with proof data)", async () => {
    const proofData = {
      serverName: "api.coingecko.com",
      recv: '{"bitcoin":{"usd":65000}}',
      notaryKey: "notary123",
      time: 1700000000,
    };

    const rpc = makeRpc({
      hash: "0xtlsn456",
      blockNumber: 200,
      status: "confirmed",
      content: {
        from: "0xagent",
        to: "0xstorage",
        type: "storage",
        data: proofData,
        timestamp: 1700000000,
      },
    });

    const result = await resolveAttestation(rpc, "0xtlsn456");

    expect(result.verified).toBe(true);
    expect(result).toMatchObject({
      verified: true,
      method: "TLSN",
      sourceUrl: "api.coingecko.com",
      responseData: '{"bitcoin":{"usd":65000}}',
      notaryKey: "notary123",
    });
  });

  it("resolves TLSN with storage-wrapped data ([storage, payload])", async () => {
    const proofData = {
      serverName: "api.example.com",
      recv: "response data",
      notaryKey: "key1",
    };

    const rpc = makeRpc({
      hash: "0xwrapped",
      blockNumber: 300,
      status: "confirmed",
      content: {
        from: "0xagent",
        to: "0xstorage",
        type: "storage",
        data: ["storage", proofData],
        timestamp: 1700000000,
      },
    });

    const result = await resolveAttestation(rpc, "0xwrapped");
    expect(result.verified).toBe(true);
    expect((result as TlsnProof).method).toBe("TLSN");
  });

  it("resolves TLSN with JSON string data", async () => {
    const rpc = makeRpc({
      hash: "0xjson",
      blockNumber: 400,
      status: "confirmed",
      content: {
        from: "0xagent",
        to: "0xstorage",
        type: "storage",
        data: JSON.stringify({ serverName: "api.test.com", recv: "data", notaryKey: "k" }),
        timestamp: 1700000000,
      },
    });

    const result = await resolveAttestation(rpc, "0xjson");
    expect(result.verified).toBe(true);
    expect((result as TlsnProof).method).toBe("TLSN");
  });

  it("returns failure when tx not found", async () => {
    const rpc = makeRpc(null);
    const result = await resolveAttestation(rpc, "0xmissing");
    expect(result).toEqual({ verified: false, reason: "tx_not_found" });
  });

  it("returns failure when tx not confirmed", async () => {
    const rpc = makeRpc({
      hash: "0xpending",
      blockNumber: 0,
      status: "pending",
      content: { from: "x", to: "y", type: "web2", data: {}, timestamp: 0 },
    });

    const result = await resolveAttestation(rpc, "0xpending");
    expect(result).toEqual({ verified: false, reason: "tx_not_confirmed" });
  });

  it("returns failure for unknown attestation type", async () => {
    const rpc = makeRpc({
      hash: "0xunknown",
      blockNumber: 500,
      status: "confirmed",
      content: {
        from: "0xagent",
        to: "0xother",
        type: "storage",
        data: { someField: "not a proof" },
        timestamp: 1700000000,
      },
    });

    const result = await resolveAttestation(rpc, "0xunknown");
    expect(result).toEqual({ verified: false, reason: "unknown_attestation_type" });
  });

  it("returns failure when RPC throws", async () => {
    const rpc: ChainReaderRpc = {
      getTxByHash: async () => { throw new Error("network timeout"); },
    };

    const result = await resolveAttestation(rpc, "0xtimeout");
    expect(result).toEqual({ verified: false, reason: "rpc_error" });
  });

  it("returns failure when RPC unavailable", async () => {
    const rpc: ChainReaderRpc = {};
    const result = await resolveAttestation(rpc, "0xno-rpc");
    expect(result).toEqual({ verified: false, reason: "rpc_unavailable" });
  });

  it("returns tx_no_content as permanent failure", async () => {
    const rpc = makeRpc({
      hash: "0xnocontent",
      blockNumber: 100,
      status: "confirmed",
      content: null,
    });
    const result = await resolveAttestation(rpc, "0xnocontent");
    expect(result).toEqual({ verified: false, reason: "tx_no_content" });
    expect(PERMANENT_FAILURES.has(result.verified === false ? result.reason as FailureReason : "" as FailureReason)).toBe(true);
  });
});

describe("compareProofToSnapshot", () => {
  const dahrProof: DahrProof = {
    verified: true,
    method: "DAHR",
    sourceUrl: "https://api.example.com",
    responseHash: "hash123",
    timestamp: 1700000000,
    chainData: { url: "https://api.example.com", responseHash: "hash123" },
  };

  const tlsnProof: TlsnProof = {
    verified: true,
    method: "TLSN",
    sourceUrl: "api.example.com",
    responseData: '{"bitcoin":{"usd":65000},"ethereum":{"usd":3500}}',
    notaryKey: "notary1",
    timestamp: 1700000000,
    chainData: {},
  };

  it("returns match for DAHR (existence = trust)", () => {
    const result = compareProofToSnapshot(dahrProof, { price: 65000 });
    expect(result.status).toBe("match");
  });

  it("returns unverifiable when no snapshot", () => {
    const result = compareProofToSnapshot(dahrProof, null);
    expect(result.status).toBe("unverifiable");
  });

  it("returns match when TLSN response contains snapshot values", () => {
    const result = compareProofToSnapshot(tlsnProof, {
      bitcoin_usd: "65000",
      ethereum_usd: "3500",
    });
    expect(result.status).toBe("match");
  });

  it("returns mismatch when TLSN response lacks snapshot values", () => {
    const result = compareProofToSnapshot(tlsnProof, {
      solana_usd: "180",
      cardano_usd: "0.65",
    });
    expect(result.status).toBe("mismatch");
  });

  it("returns partial when some values match", () => {
    const result = compareProofToSnapshot(tlsnProof, {
      bitcoin_usd: "65000",
      solana_usd: "180",
      cardano_usd: "0.65",
    });
    expect(result.status).toBe("partial");
  });

  it("returns partial when TLSN has no responseData", () => {
    const noData: TlsnProof = { ...tlsnProof, responseData: null };
    const result = compareProofToSnapshot(noData, { price: 65000 });
    expect(result.status).toBe("partial");
  });

  it("returns unverifiable when snapshot has no scalar values", () => {
    const result = compareProofToSnapshot(tlsnProof, {
      nested: { deep: true },
      arr: [1, 2, 3],
    });
    expect(result.status).toBe("unverifiable");
  });
});
