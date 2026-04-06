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
