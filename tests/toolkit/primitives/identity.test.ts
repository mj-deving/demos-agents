import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createIdentityPrimitives } from "../../../src/toolkit/primitives/identity.js";

describe("identity.lookup", () => {
  it("routes to lookupByPlatform when platform+username provided", async () => {
    const data = { platform: "twitter", username: "test", accounts: [], found: true };
    const client = createMockApiClient({ lookupByPlatform: vi.fn().mockResolvedValue(mockOk(data)) });
    const id = createIdentityPrimitives({ apiClient: client });
    const result = await id.lookup({ platform: "twitter", username: "test" });

    expect(result).toEqual(mockOk(data));
    expect(client.lookupByPlatform).toHaveBeenCalledWith("twitter", "test");
  });

  it("routes to lookupByChainAddress when chain+address provided", async () => {
    const data = { platform: "demos", username: "0xa1", accounts: [], found: true };
    const client = createMockApiClient({ lookupByChainAddress: vi.fn().mockResolvedValue(mockOk(data)) });
    const id = createIdentityPrimitives({ apiClient: client });
    const result = await id.lookup({ chain: "demos", address: "0xa1" });

    expect(result).toEqual(mockOk(data));
    expect(client.lookupByChainAddress).toHaveBeenCalledWith("demos", "0xa1");
  });

  it("routes to searchIdentity when query provided", async () => {
    const data = { results: [] };
    const client = createMockApiClient({ searchIdentity: vi.fn().mockResolvedValue(mockOk(data)) });
    const id = createIdentityPrimitives({ apiClient: client });
    const result = await id.lookup({ query: "some user" });

    expect(result).toEqual(mockOk(data));
    expect(client.searchIdentity).toHaveBeenCalledWith("some user");
  });

  it("returns error when no valid params provided", async () => {
    const id = createIdentityPrimitives({ apiClient: createMockApiClient() });
    const result = await id.lookup({});

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
  });
});
