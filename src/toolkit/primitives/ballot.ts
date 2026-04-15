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

    async getHigherLowerPool(opts) {
      return deps.apiClient.getHigherLowerPool(opts?.asset ?? "BTC", opts?.horizon);
    },

    async getBinaryPools(opts) {
      return deps.apiClient.getBinaryPools(opts);
    },

    async getEthPool(opts) {
      return deps.apiClient.getEthBettingPool(opts?.asset ?? "BTC", opts?.horizon);
    },

    async getEthWinners(opts) {
      return deps.apiClient.getEthWinners(opts?.asset ?? "BTC");
    },

    async getEthHigherLowerPool(opts) {
      return deps.apiClient.getEthHigherLowerPool(opts?.asset ?? "BTC", opts?.horizon);
    },

    async getEthBinaryPools() {
      return deps.apiClient.getEthBinaryPools();
    },

    async getSportsMarkets(opts) {
      return deps.apiClient.getSportsMarkets({ status: opts?.status ?? "upcoming" });
    },

    async getSportsPool(fixtureId) {
      return deps.apiClient.getSportsPool(fixtureId);
    },

    async getSportsWinners(fixtureId) {
      return deps.apiClient.getSportsWinners(fixtureId);
    },

    async getCommodityPool(opts) {
      return deps.apiClient.getCommodityPool(opts?.asset ?? "XAU", opts?.horizon);
    },
  };
}
