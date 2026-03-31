import { describe, expect, it } from "vitest";

import {
  CONTRACT_REGISTRY,
  deriveValue,
  resolveChainSource,
} from "../../../src/toolkit/chain/index.js";

describe("toolkit chain contract registry", () => {
  it("resolves known protocol and metric mappings", () => {
    const compoundTvl = resolveChainSource("Compound", "tvl");
    expect(compoundTvl).not.toBeNull();
    expect(compoundTvl?.protocol.chain).toBe("eth:1");
    expect(compoundTvl?.metricDef.function).toBe("totalSupply");

    const aaveGovernance = resolveChainSource("Aave governance", "proposal_state");
    expect(aaveGovernance).not.toBeNull();
    expect(aaveGovernance?.metricDef.function).toBe("getProposalState");
    expect(aaveGovernance?.metricDef.params).toEqual(["entityId"]);

    const marinadeTvl = resolveChainSource("Marinade Finance", "tvl");
    expect(marinadeTvl).not.toBeNull();
    expect(marinadeTvl?.protocol.chain).toBe("sol:mainnet");
    expect(marinadeTvl?.metricDef.function).toBe("fetchAccount");
  });

  it("returns null for unknown protocols or unsupported metrics", () => {
    expect(resolveChainSource("Unknown Protocol", "tvl")).toBeNull();
    expect(resolveChainSource("Uniswap", "tvl")).toBeNull();
  });

  it("derives human values from decimal-scaled chain reads", () => {
    expect(deriveValue("123456789", {
      rawUnit: "base_units",
      decimals: 6,
      outputUnit: "USD",
    })).toBe(123.456789);

    expect(deriveValue(42_000_000_000n, {
      rawUnit: "lamports",
      decimals: 9,
      outputUnit: "SOL",
    })).toBe(42);

    expect(deriveValue("not-a-number", {
      rawUnit: "base_units",
      decimals: 6,
      outputUnit: "USD",
    })).toBeNull();
  });

  it("ships the expected default registry surface", () => {
    expect(CONTRACT_REGISTRY.compound.contracts.governance.address).toMatch(/^0x/i);
    expect(CONTRACT_REGISTRY.marinade.metrics.tvl.derivation?.outputUnit).toBe("SOL");
    expect(CONTRACT_REGISTRY.uniswap.metrics).toEqual({});
  });
});
