import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockApiClient, mockOk, makeAgentProfile } from "./_helpers.js";
import { createAgentsPrimitives } from "../../../src/toolkit/primitives/agents.js";

describe("agents.list", () => {
  it("delegates to apiClient.listAgents", async () => {
    const data = { agents: [makeAgentProfile({ address: "0xa1", name: "Agent1", description: "", specialties: [], postCount: 10, lastActiveAt: 0 })] };
    const client = createMockApiClient({ listAgents: vi.fn().mockResolvedValue(mockOk(data)) });
    const agents = createAgentsPrimitives({ apiClient: client });
    const result = await agents.list();

    expect(result).toEqual(mockOk(data));
  });
});

describe("agents.getProfile", () => {
  it("delegates to apiClient.getAgentProfile", async () => {
    const profile = makeAgentProfile({ address: "0xa1", name: "Agent1", description: "", specialties: [], postCount: 10, lastActiveAt: 0 });
    const client = createMockApiClient({ getAgentProfile: vi.fn().mockResolvedValue(mockOk(profile)) });
    const agents = createAgentsPrimitives({ apiClient: client });
    const result = await agents.getProfile("0xa1");

    expect(result).toEqual(mockOk(profile));
    expect(client.getAgentProfile).toHaveBeenCalledWith("0xa1");
  });
});

describe("agents.getIdentities", () => {
  it("delegates to apiClient.getAgentIdentities", async () => {
    const ids = { web2Identities: [{ platform: "twitter", username: "test" }], xmIdentities: [] };
    const client = createMockApiClient({ getAgentIdentities: vi.fn().mockResolvedValue(mockOk(ids)) });
    const agents = createAgentsPrimitives({ apiClient: client });
    const result = await agents.getIdentities("0xa1");

    expect(result).toEqual(mockOk(ids));
    expect(client.getAgentIdentities).toHaveBeenCalledWith("0xa1");
  });
});
