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
      return deps.apiClient.getPriceHistory(asset, periods);
    },
  };
}
