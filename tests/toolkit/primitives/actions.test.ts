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
    const result = await actions.tip("0xpost1", 0.5);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      expect(result!.data.txHash).toBe("0xtx1");
      expect(result!.data.validated).toBe(true);
    }
    expect(client.initiateTip).toHaveBeenCalledWith("0xpost1", 0.5);
    expect(transferDem).toHaveBeenCalledWith("0xrecipient", 0.5, "tip:0xpost1");
  });

  it("returns error when API validation fails", async () => {
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue(mockErr(400, "Spam limit")),
    });
    const actions = createActionsPrimitives({ apiClient: client });
    const result = await actions.tip("0xpost1", 0.5);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
  });

  it("returns null when API unreachable", async () => {
    const actions = createActionsPrimitives({ apiClient: createMockApiClient() });
    expect(await actions.tip("0xpost1", 0.5)).toBeNull();
  });

  it("returns error when no transferDem available", async () => {
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue(mockOk({ ok: true, recipient: "0xr" })),
    });
    const actions = createActionsPrimitives({ apiClient: client });
    const result = await actions.tip("0xpost1", 0.5);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
  });

  it("returns error when chain transfer throws", async () => {
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue(mockOk({ ok: true, recipient: "0xr" })),
    });
    const transferDem = vi.fn().mockRejectedValue(new Error("insufficient funds"));
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.tip("0xpost1", 0.5);

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
    const pool = { asset: "BTC", horizon: "1h", totalBets: 3, totalDem: 15, poolAddress: "0xpool", roundEnd: 0, bets: [] };
    const client = createMockApiClient({ getBettingPool: vi.fn().mockResolvedValue(mockOk(pool)) });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xbet1" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    const result = await actions.placeBet("BTC", 70000, { horizon: "1h" });

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result!.ok) expect(result!.data.txHash).toBe("0xbet1");
    expect(client.getBettingPool).toHaveBeenCalledWith("BTC", "1h");
    expect(transferDem).toHaveBeenCalledWith("0xpool", 5, "HIVE_BET:BTC:70000:1h");
  });

  it("defaults horizon to 1h", async () => {
    const pool = { asset: "BTC", horizon: "1h", totalBets: 0, totalDem: 0, poolAddress: "0xp", roundEnd: 0, bets: [] };
    const client = createMockApiClient({ getBettingPool: vi.fn().mockResolvedValue(mockOk(pool)) });
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xbet2" });
    const actions = createActionsPrimitives({ apiClient: client, transferDem });
    await actions.placeBet("ETH", 3500);

    expect(client.getBettingPool).toHaveBeenCalledWith("ETH", "1h");
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
    expect(transferDem).not.toHaveBeenCalled();
  });
});
