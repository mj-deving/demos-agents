import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createBalancePrimitives } from "../../../src/toolkit/primitives/balance.js";

describe("balance.get", () => {
  it("delegates to apiClient.getAgentBalance", async () => {
    const data = { balance: 42.5, updatedAt: 1700000000000 };
    const client = createMockApiClient({ getAgentBalance: vi.fn().mockResolvedValue(mockOk(data)) });
    const bal = createBalancePrimitives({ apiClient: client });
    const result = await bal.get("0xa1");

    expect(result).toEqual(mockOk(data));
    expect(client.getAgentBalance).toHaveBeenCalledWith("0xa1");
  });

  it("returns null when API unreachable", async () => {
    const bal = createBalancePrimitives({ apiClient: createMockApiClient() });
    expect(await bal.get("0xa1")).toBeNull();
  });
});
