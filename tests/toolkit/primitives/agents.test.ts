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

describe("agents.createLinkChallenge", () => {
  it("delegates to apiClient.createAgentLinkChallenge", async () => {
    const payload = { challenge: "n1", challengeId: "c1", message: "sign me", nonce: "n1", humanAddress: "0xhuman" };
    const client = createMockApiClient({ createAgentLinkChallenge: vi.fn().mockResolvedValue(mockOk(payload)) });
    const agents = createAgentsPrimitives({ apiClient: client });
    const result = await agents.createLinkChallenge("0xa1");

    expect(result).toEqual(mockOk(payload));
    expect(client.createAgentLinkChallenge).toHaveBeenCalledWith("0xa1");
  });
});

describe("agents.claimLink", () => {
  it("delegates to apiClient.claimAgentLink", async () => {
    const payload = { ok: true, status: "pending_approval" };
    const client = createMockApiClient({ claimAgentLink: vi.fn().mockResolvedValue(mockOk(payload)) });
    const agents = createAgentsPrimitives({ apiClient: client });
    const result = await agents.claimLink({ challenge: "n1", challengeId: "c1", agentAddress: "0xa1", signature: "sig" });

    expect(result).toEqual(mockOk(payload));
    expect(client.claimAgentLink).toHaveBeenCalledWith({ challenge: "n1", challengeId: "c1", agentAddress: "0xa1", signature: "sig" });
  });
});

describe("agents.approveLink", () => {
  it("delegates to apiClient.approveAgentLink", async () => {
    const payload = { ok: true, status: "approved", linked: true };
    const client = createMockApiClient({ approveAgentLink: vi.fn().mockResolvedValue(mockOk(payload)) });
    const agents = createAgentsPrimitives({ apiClient: client });
    const result = await agents.approveLink({ challenge: "n1", challengeId: "c1", agentAddress: "0xa1", action: "approve" });

    expect(result).toEqual(mockOk(payload));
    expect(client.approveAgentLink).toHaveBeenCalledWith({ challenge: "n1", challengeId: "c1", agentAddress: "0xa1", action: "approve" });
  });
});

describe("agents.listLinked", () => {
  it("delegates to apiClient.listLinkedAgents", async () => {
    const payload = { agents: [{ address: "0xa1", name: "sentinel", relationship: "owner", linkedAt: 123 }] };
    const client = createMockApiClient({ listLinkedAgents: vi.fn().mockResolvedValue(mockOk(payload)) });
    const agents = createAgentsPrimitives({ apiClient: client });
    const result = await agents.listLinked();

    expect(result).toEqual(mockOk(payload));
    expect(client.listLinkedAgents).toHaveBeenCalled();
  });
});

describe("agents.unlink", () => {
  it("delegates to apiClient.unlinkAgent", async () => {
    const client = createMockApiClient({ unlinkAgent: vi.fn().mockResolvedValue(mockOk(undefined)) });
    const agents = createAgentsPrimitives({ apiClient: client });
    await agents.unlink("0xa1");

    expect(client.unlinkAgent).toHaveBeenCalledWith("0xa1");
  });
});
