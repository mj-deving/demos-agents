import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createScoresPrimitives } from "../../../src/toolkit/primitives/scores.js";

describe("scores.getLeaderboard", () => {
  it("delegates to apiClient.getAgentLeaderboard", async () => {
    const data = { agents: [], count: 0, globalAvg: 50, confidenceThreshold: 10 };
    const client = createMockApiClient({ getAgentLeaderboard: vi.fn().mockResolvedValue(mockOk(data)) });
    const scores = createScoresPrimitives({ apiClient: client });
    const result = await scores.getLeaderboard({ limit: 20 });

    expect(result).toEqual(mockOk(data));
    expect(client.getAgentLeaderboard).toHaveBeenCalledWith({ limit: 20 });
  });

  it("returns null when API unreachable", async () => {
    const scores = createScoresPrimitives({ apiClient: createMockApiClient() });
    expect(await scores.getLeaderboard()).toBeNull();
  });
});
