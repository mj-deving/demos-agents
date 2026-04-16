import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk, mockErr } from "./_helpers.js";
import { createActionsPrimitives } from "../../../src/toolkit/primitives/actions.js";

describe("actions.tip", () => {
  it("validates via API then transfers on chain", async () => {
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue(mockOk({ ok: true, recipient: "0xrecipient" })),
    });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xtx1" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.tip("0xpost1", 5);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      expect(result!.data.txHash).toBe("0xtx1");
      expect(result!.data.validated).toBe(true);
    }
    expect(client.initiateTip).toHaveBeenCalledWith("0xpost1", 5);
    expect(transferDem).toHaveBeenCalledWith("0xrecipient", 5, "HIVE_TIP:0xpost1");
  });

  it("rounds fractional amounts to nearest integer (API requires integers)", async () => {
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue(mockOk({ ok: true, recipient: "0xr" })),
    });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xtx" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    await actions.tip("0xpost1", 2.7);

    expect(client.initiateTip).toHaveBeenCalledWith("0xpost1", 3);
    expect(transferDem).toHaveBeenCalledWith("0xr", 3, "HIVE_TIP:0xpost1");
  });

  it("clamps amount below 1 up to 1", async () => {
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue(mockOk({ ok: true, recipient: "0xr" })),
    });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xtx" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    await actions.tip("0xpost1", 0.3);

    // 0.3 rounds to 0, clamped up to 1
    expect(client.initiateTip).toHaveBeenCalledWith("0xpost1", 1);
    expect(transferDem).toHaveBeenCalledWith("0xr", 1, "HIVE_TIP:0xpost1");
  });

  it("clamps amount above 10 down to 10", async () => {
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue(mockOk({ ok: true, recipient: "0xr" })),
    });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xtx" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    await actions.tip("0xpost1", 25);

    expect(client.initiateTip).toHaveBeenCalledWith("0xpost1", 10);
    expect(transferDem).toHaveBeenCalledWith("0xr", 10, "HIVE_TIP:0xpost1");
  });

  it("returns error when API validation fails", async () => {
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue(mockErr(400, "Spam limit")),
    });
    const actions = createActionsPrimitives({ apiClient: client });
    const result = await actions.tip("0xpost1", 5);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
  });

  it("returns null when API unreachable", async () => {
    const actions = createActionsPrimitives({ apiClient: createMockApiClient() });
    expect(await actions.tip("0xpost1", 5)).toBeNull();
  });

  it("returns error when no transferDem available", async () => {
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue(mockOk({ ok: true, recipient: "0xr" })),
    });
    const actions = createActionsPrimitives({ apiClient: client });
    const result = await actions.tip("0xpost1", 5);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
  });

  it("returns error when chain transfer throws", async () => {
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue(mockOk({ ok: true, recipient: "0xr" })),
    });
    const transferDem = vi.fn().mockRejectedValue(new Error("insufficient funds"));
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.tip("0xpost1", 5);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.error).toContain("insufficient funds");
    }
  });
});

describe("actions.react", () => {
  it("delegates to apiClient.react", async () => {
    const client = createMockApiClient({ react: vi.fn().mockResolvedValue(mockOk(undefined)) });
    const actions = createActionsPrimitives({ apiClient: client });
    const result = await actions.react("0xtx1", "agree");

    expect(result).toEqual(mockOk(undefined));
    expect(client.react).toHaveBeenCalledWith("0xtx1", "agree");
  });
});

describe("actions.getReactions", () => {
  it("delegates to apiClient.getReactionCounts", async () => {
    const data = { agree: 5, disagree: 2, flag: 0 };
    const client = createMockApiClient({ getReactionCounts: vi.fn().mockResolvedValue(mockOk(data)) });
    const actions = createActionsPrimitives({ apiClient: client });
    const result = await actions.getReactions("0xtx1");

    expect(result).toEqual(mockOk(data));
    expect(client.getReactionCounts).toHaveBeenCalledWith("0xtx1");
  });
});

describe("actions.getTipStats", () => {
  it("delegates to apiClient.getTipStats", async () => {
    const data = { totalTips: 3, totalDem: 12, tippers: ["0xa"], topTip: 5 };
    const client = createMockApiClient({ getTipStats: vi.fn().mockResolvedValue(mockOk(data)) });
    const actions = createActionsPrimitives({ apiClient: client });
    const result = await actions.getTipStats("0xpost1");

    expect(result).toEqual(mockOk(data));
    expect(client.getTipStats).toHaveBeenCalledWith("0xpost1");
  });
});

describe("actions.getAgentTipStats", () => {
  it("delegates to apiClient.getAgentTipStats", async () => {
    const data = { tipsGiven: { count: 5, totalDem: 20 }, tipsReceived: { count: 3, totalDem: 15 } };
    const client = createMockApiClient({ getAgentTipStats: vi.fn().mockResolvedValue(mockOk(data)) });
    const actions = createActionsPrimitives({ apiClient: client });
    const result = await actions.getAgentTipStats("0xagent1");

    expect(result).toEqual(mockOk(data));
    expect(client.getAgentTipStats).toHaveBeenCalledWith("0xagent1");
  });
});

describe("actions.placeBet", () => {
  it("resolves pool address then transfers 5 DEM with HIVE_BET memo", async () => {
    const pool = { asset: "BTC", horizon: "30m", totalBets: 3, totalDem: 15, poolAddress: "0xpool", roundEnd: 0, bets: [] };
    const client = createMockApiClient({
      getBettingPool: vi.fn().mockResolvedValue(mockOk(pool)),
      registerBet: vi.fn().mockResolvedValue(mockOk({
        ok: true,
        txHash: "0xbet1",
        asset: "BTC",
        predictedPrice: 70000,
        amount: 5,
        message: "Bet placed",
      })),
    });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xbet1" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.placeBet("BTC", 70000, { horizon: "30m" });

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      expect(result!.data.txHash).toBe("0xbet1");
      expect(result!.data.registered).toBe(true);
    }
    expect(client.getBettingPool).toHaveBeenCalledWith("BTC", "30m");
    expect(client.registerBet).toHaveBeenCalledWith("0xbet1", "BTC", 70000, { horizon: "30m" });
    expect(transferDem).toHaveBeenCalledWith("0xpool", 5, "HIVE_BET:BTC:70000:30m");
  });

  it("defaults horizon to 30m", async () => {
    const pool = { asset: "BTC", horizon: "30m", totalBets: 0, totalDem: 0, poolAddress: "0xp", roundEnd: 0, bets: [] };
    const client = createMockApiClient({ getBettingPool: vi.fn().mockResolvedValue(mockOk(pool)) });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xbet2" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    await actions.placeBet("ETH", 3500);

    expect(client.getBettingPool).toHaveBeenCalledWith("ETH", "30m");
  });

  it("returns error when no transferDem available", async () => {
    const actions = createActionsPrimitives({ apiClient: createMockApiClient() });
    const result = await actions.placeBet("BTC", 70000);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
  });

  it("returns error when pool resolution fails", async () => {
    const client = createMockApiClient({ getBettingPool: vi.fn().mockResolvedValue(mockErr(404, "No pool")) });
    const transferDem = vi.fn();
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.placeBet("XYZ", 999);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.error).toContain("No pool");
    expect(transferDem).not.toHaveBeenCalled();
  });

  it("returns null when API unreachable (preserves null contract)", async () => {
    const client = createMockApiClient({ getBettingPool: vi.fn().mockResolvedValue(null) });
    const transferDem = vi.fn();
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.placeBet("BTC", 70000);

    expect(result).toBeNull();
    expect(transferDem).not.toHaveBeenCalled();
  });

  it("returns txHash with registered=false when registration fails after transfer", async () => {
    const pool = { asset: "BTC", horizon: "30m", totalBets: 3, totalDem: 15, poolAddress: "0xpool", roundEnd: 0, bets: [] };
    const client = createMockApiClient({
      getBettingPool: vi.fn().mockResolvedValue(mockOk(pool)),
      registerBet: vi.fn().mockResolvedValue(mockErr(500, "indexer lag")),
    });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xbet1" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.placeBet("BTC", 70000, { horizon: "30m" });

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      expect(result.data.txHash).toBe("0xbet1");
      expect(result.data.registered).toBe(false);
      expect(result.data.registrationError).toContain("indexer lag");
    }
  });

  it("rejects asset containing colons", async () => {
    const transferDem = vi.fn();
    const actions = createActionsPrimitives({ apiClient: createMockApiClient(), transferDem });
    const result = await actions.placeBet("BTC:USD", 70000);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.error).toContain("colons");
  });

  it("rejects NaN price", async () => {
    const transferDem = vi.fn();
    const actions = createActionsPrimitives({ apiClient: createMockApiClient(), transferDem });
    const result = await actions.placeBet("BTC", NaN);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.error).toContain("positive finite");
  });

  it("rejects negative price", async () => {
    const transferDem = vi.fn();
    const actions = createActionsPrimitives({ apiClient: createMockApiClient(), transferDem });
    const result = await actions.placeBet("BTC", -100);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
  });

  it("rejects pool with mismatched asset (echo-check)", async () => {
    const pool = { asset: "ETH", horizon: "1h", totalBets: 0, totalDem: 0, poolAddress: "0xpool", roundEnd: 0, bets: [] };
    const client = createMockApiClient({ getBettingPool: vi.fn().mockResolvedValue(mockOk(pool)) });
    const transferDem = vi.fn();
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.placeBet("BTC", 70000);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.error).toContain("mismatch");
    expect(transferDem).not.toHaveBeenCalled();
  });

  it("rejects pool with empty address", async () => {
    const pool = { asset: "BTC", horizon: "1h", totalBets: 0, totalDem: 0, poolAddress: "", roundEnd: 0, bets: [] };
    const client = createMockApiClient({ getBettingPool: vi.fn().mockResolvedValue(mockOk(pool)) });
    const transferDem = vi.fn();
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.placeBet("BTC", 70000);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.error).toContain("invalid address");
    expect(transferDem).not.toHaveBeenCalled();
  });
});

describe("actions.placeHL", () => {
  it("transfers then registers higher-lower bets with normalized memo", async () => {
    const pool = { asset: "BTC", horizon: "30m", totalHigher: 1, totalLower: 1, totalDem: 10, higherCount: 1, lowerCount: 1, roundEnd: 0, referencePrice: null, poolAddress: "0xpool", currentPrice: 70000 };
    const client = createMockApiClient({
      getHigherLowerPool: vi.fn().mockResolvedValue(mockOk(pool)),
      registerHigherLowerBet: vi.fn().mockResolvedValue(mockOk({
        ok: true,
        txHash: "0xhl1",
        asset: "BTC",
        direction: "HIGHER",
        horizon: "30m",
        amount: 5,
        message: "Prediction placed: BTC HIGHER",
      })),
    });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xhl1" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.placeHL("BTC", "higher", { amount: 2, horizon: "30m" });

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      expect(result.data.txHash).toBe("0xhl1");
      expect(result.data.memo).toBe("HIVE_HL:BTC:HIGHER:30m");
      expect(result.data.registered).toBe(true);
    }
    expect(transferDem).toHaveBeenCalledWith("0xpool", 2, "HIVE_HL:BTC:HIGHER:30m");
    expect(client.registerHigherLowerBet).toHaveBeenCalledWith("0xhl1", "BTC", "HIGHER", { horizon: "30m" });
  });

  it("rounds fractional amounts to integers and clamps the minimum to 1 DEM", async () => {
    const pool = { asset: "BTC", horizon: "30m", totalHigher: 1, totalLower: 1, totalDem: 10, higherCount: 1, lowerCount: 1, roundEnd: 0, referencePrice: null, poolAddress: "0xpool", currentPrice: 70000 };
    const client = createMockApiClient({
      getHigherLowerPool: vi.fn().mockResolvedValue(mockOk(pool)),
      registerHigherLowerBet: vi.fn().mockResolvedValue(mockOk({
        ok: true,
        txHash: "0xhl2",
        asset: "BTC",
        direction: "HIGHER",
        horizon: "30m",
        amount: 1,
        message: "Prediction placed: BTC HIGHER",
      })),
    });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xhl2" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });

    await actions.placeHL("BTC", "higher", { amount: 0.3, horizon: "30m" });

    expect(transferDem).toHaveBeenCalledWith("0xpool", 1, "HIVE_HL:BTC:HIGHER:30m");
  });

  it("clamps higher-lower amounts above the ceiling down to 5 DEM", async () => {
    const pool = { asset: "BTC", horizon: "30m", totalHigher: 1, totalLower: 1, totalDem: 10, higherCount: 1, lowerCount: 1, roundEnd: 0, referencePrice: null, poolAddress: "0xpool", currentPrice: 70000 };
    const client = createMockApiClient({
      getHigherLowerPool: vi.fn().mockResolvedValue(mockOk(pool)),
      registerHigherLowerBet: vi.fn().mockResolvedValue(mockOk({
        ok: true,
        txHash: "0xhl3",
        asset: "BTC",
        direction: "HIGHER",
        horizon: "30m",
        amount: 5,
        message: "Prediction placed: BTC HIGHER",
      })),
    });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xhl3" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });

    await actions.placeHL("BTC", "higher", { amount: 9.9, horizon: "30m" });

    expect(transferDem).toHaveBeenCalledWith("0xpool", 5, "HIVE_HL:BTC:HIGHER:30m");
  });
});

describe("actions.register helpers", () => {
  it("registerBet delegates to apiClient.registerBet", async () => {
    const client = createMockApiClient({
      registerBet: vi.fn().mockResolvedValue(mockOk({
        ok: true,
        txHash: "tx1",
        asset: "BTC",
        predictedPrice: 70000,
        amount: 5,
        message: "Bet placed",
      })),
    });
    const actions = createActionsPrimitives({ apiClient: client });
    const result = await actions.registerBet("tx1", "BTC", 70000, { horizon: "30m" });

    expect(result).toEqual(mockOk({
      ok: true,
      txHash: "tx1",
      asset: "BTC",
      predictedPrice: 70000,
      amount: 5,
      message: "Bet placed",
    }));
    expect(client.registerBet).toHaveBeenCalledWith("tx1", "BTC", 70000, { horizon: "30m" });
  });

  it("registerEthBinaryBet rejects malformed tx hashes before hitting the API", async () => {
    const client = createMockApiClient();
    const actions = createActionsPrimitives({ apiClient: client });
    const result = await actions.registerEthBinaryBet("not-a-hash");

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result.error).toContain("0x-prefixed");
    }
    expect(client.registerEthBinaryBet).not.toHaveBeenCalled();
  });
});
