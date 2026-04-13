/**
 * Ballot domain — active betting pools via /api/bets/pool.
 *
 * Legacy ballot endpoints (/api/ballot/*) returned 410 Gone and have been removed.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { BallotPrimitives } from "./types.js";

export function createBallotPrimitives(deps: { apiClient: SuperColonyApiClient }): BallotPrimitives {
  return {
    async getPool(opts) {
      // asset defaults to "BTC" if not specified — the pool endpoint requires it
      return deps.apiClient.getBettingPool(opts?.asset ?? "BTC", opts?.horizon);
    },
  };
}
