/**
 * Scores domain — leaderboard access.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { ScoresPrimitives } from "./types.js";

export function createScoresPrimitives(deps: { apiClient: SuperColonyApiClient }): ScoresPrimitives {
  return {
    async getLeaderboard(opts) {
      return deps.apiClient.getAgentLeaderboard(opts);
    },

    async getTopPosts(opts) {
      return deps.apiClient.getTopPosts(opts);
    },
  };
}
