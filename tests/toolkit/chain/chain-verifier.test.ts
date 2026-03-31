import { describe, expect, it } from "vitest";

import {
  MockChainAdapter,
  verifyClaimOnChain,
} from "../../../src/toolkit/chain/index.js";
import type { StructuredClaim } from "../../../src/toolkit/publish/types.js";

function makeClaim(overrides: Partial<StructuredClaim> = {}): StructuredClaim {
  return {
    identity: {
      chain: "ethereum",
      address: null,
      market: null,
      entityId: null,
      metric: "tvl",
      ...(overrides.identity ?? {}),
    },
    subject: "Compound",
    value: null,
    unit: "USD",
    direction: null,
    dataTimestamp: null,
    sourceField: null,
    type: "factual",
    ...overrides,
  };
}

describe("verifyClaimOnChain", () => {
  it("verifies an EVM metric read with derivation and provenance", async () => {
    const adapter = new MockChainAdapter({
      family: "evm",
      readContractResult: "123450000",
      getBlockNumberResult: 19_337,
    });

    const result = await verifyClaimOnChain(makeClaim(), {
      adapters: new Map([["evm", adapter]]),
    });

    expect(result).toMatchObject({
      verified: true,
      source: "chain-native",
      data: "123450000",
      derivedValue: 123.45,
      trustTier: "authoritative",
    });
    expect(result.provenance).not.toBeNull();
    expect(result.provenance?.chainId).toBe("eth:1");
    expect(result.provenance?.contractAddress).toBe(
      "0x39AA39c021dfbaE8faC545936693aC917d5E7563"
    );
    expect(result.provenance?.method).toBe("totalSupply");
    expect(result.provenance?.args).toEqual([]);
    expect(result.provenance?.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);

    expect(adapter.connections).toEqual(["chain://eth:1"]);
    expect(adapter.readContractCalls).toEqual([{
      address: "0x39AA39c021dfbaE8faC545936693aC917d5E7563",
      abi: [{
        type: "function",
        name: "totalSupply",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
      }],
      fn: "totalSupply",
      args: [],
    }]);
    expect(adapter.isConnected).toBe(false);
  });

  it("extracts Solana account state for fetchAccount-based metrics", async () => {
    const adapter = new MockChainAdapter({
      family: "solana",
      readContractResult: {
        totalStakedSol: "42000000000",
        validatorCount: 100,
      },
      getBlockNumberResult: 987654,
    });

    const result = await verifyClaimOnChain(makeClaim({
      subject: "Marinade Finance",
      unit: "SOL",
      identity: {
        chain: "solana",
        address: null,
        market: null,
        entityId: null,
        metric: "tvl",
      },
    }), {
      adapters: new Map([["solana", adapter]]),
    });

    expect(result.verified).toBe(true);
    expect(result.data).toBe("42000000000");
    expect(result.derivedValue).toBe(42);
    expect(result.provenance?.chainId).toBe("sol:mainnet");
    expect(result.provenance?.method).toBe("fetchAccount");
  });

  it("maps governance enums and passes claim parameters into the read", async () => {
    const adapter = new MockChainAdapter({
      family: "evm",
      readContractResult: 4,
      getBlockNumberResult: 77,
    });

    const result = await verifyClaimOnChain(makeClaim({
      subject: "Aave",
      unit: "none",
      identity: {
        chain: "ethereum",
        address: null,
        market: null,
        entityId: "42",
        metric: "proposal_state",
      },
    }), {
      adapters: new Map([["evm", adapter]]),
    });

    expect(result).toMatchObject({
      verified: true,
      data: "succeeded",
      derivedValue: null,
      trustTier: "authoritative",
    });
    expect(result.provenance?.args).toEqual(["42"]);
    expect(adapter.readContractCalls[0]?.fn).toBe("getProposalState");
    expect(adapter.readContractCalls[0]?.args).toEqual(["42"]);
  });

  it("returns a failed trust tier when the adapter read errors", async () => {
    const adapter = new MockChainAdapter({
      family: "evm",
      readContractError: "rpc offline",
    });

    const result = await verifyClaimOnChain(makeClaim(), {
      adapters: new Map([["evm", adapter]]),
    });

    expect(result).toEqual({
      verified: false,
      source: "chain-native",
      data: null,
      derivedValue: null,
      provenance: null,
      trustTier: "failed",
      error: "rpc offline",
    });
    expect(adapter.isConnected).toBe(false);
  });

  it("returns a failed result when no registry entry matches the claim", async () => {
    const result = await verifyClaimOnChain(makeClaim({
      subject: "Mystery Protocol",
    }));

    expect(result.verified).toBe(false);
    expect(result.trustTier).toBe("failed");
    expect(result.error).toContain("no chain source registered");
  });
});
