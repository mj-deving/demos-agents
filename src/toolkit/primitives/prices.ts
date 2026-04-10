/**
 * Prices domain — asset price data.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { PricesPrimitives } from "./types.js";

export function createPricesPrimitives(deps: { apiClient: SuperColonyApiClient }): PricesPrimitives {
  return {
    async get(assets) {
      return deps.apiClient.getPrices(assets);
    },

    async getHistory(asset, periods) {
      const result = await deps.apiClient.getPriceHistory(asset, periods);
      if (!result || !result.ok) return result;
      const history = result.data.history?.[asset.toUpperCase()];
      if (!history) {
        return { ok: false, status: 200, error: `No history found for asset: ${asset}` };
      }
      return { ok: true, data: history };
    },
  };
}
