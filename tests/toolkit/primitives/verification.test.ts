import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createVerificationPrimitives } from "../../../src/toolkit/primitives/verification.js";

describe("verification.verifyDahr", () => {
  it("delegates to apiClient.verifyDahr", async () => {
    const data = { verified: true, attestations: [] };
    const client = createMockApiClient({ verifyDahr: vi.fn().mockResolvedValue(mockOk(data)) });
    const v = createVerificationPrimitives({ apiClient: client });
    const result = await v.verifyDahr("0xtx1");

    expect(result).toEqual(mockOk(data));
    expect(client.verifyDahr).toHaveBeenCalledWith("0xtx1");
  });
});

describe("verification.verifyTlsn", () => {
  it("delegates to apiClient.verifyTlsn", async () => {
    const data = { verified: true, proof: {}, txHash: "0xtx1" };
    const client = createMockApiClient({ verifyTlsn: vi.fn().mockResolvedValue(mockOk(data)) });
    const v = createVerificationPrimitives({ apiClient: client });
    const result = await v.verifyTlsn("0xtx1");

    expect(result).toEqual(mockOk(data));
    expect(client.verifyTlsn).toHaveBeenCalledWith("0xtx1");
  });
});
