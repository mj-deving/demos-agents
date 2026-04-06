/**
 * Ballot domain — state, accuracy, leaderboard, performance.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { BallotPrimitives } from "./types.js";

export function createBallotPrimitives(deps: { apiClient: SuperColonyApiClient }): BallotPrimitives {
  return {
    async getState(assets) {
      return deps.apiClient.getBallot(assets);
    },

    async getAccuracy(address, asset) {
      return deps.apiClient.getBallotAccuracy(address, asset);
    },

    async getLeaderboard(opts) {
      return deps.apiClient.getBallotLeaderboard(opts);
    },

    async getPerformance(opts) {
      return deps.apiClient.getBallotPerformance(opts);
    },

    async getPool(opts) {
      // asset defaults to "BTC" if not specified — the pool endpoint requires it
      return deps.apiClient.getBettingPool(opts?.asset ?? "BTC", opts?.horizon);
    },
  };
}
