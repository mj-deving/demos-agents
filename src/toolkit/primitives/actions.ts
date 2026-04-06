/**
 * Actions domain — tip, react, bet, and related stats.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { ApiResult } from "../supercolony/types.js";
import type { ActionsPrimitives } from "./types.js";

interface ActionsDeps {
  apiClient: SuperColonyApiClient;
  transferDem?: (to: string, amount: number, memo: string) => Promise<{ txHash: string }>;
}

export function createActionsPrimitives(deps: ActionsDeps): ActionsPrimitives {
  return {
    async tip(postTxHash, amount): Promise<ApiResult<{ txHash: string; validated: boolean }>> {
      // Phase 1: Validate via API (spam limits, indexer attribution)
      const validation = await deps.apiClient.initiateTip(postTxHash, amount);
      if (!validation || !validation.ok) {
        if (!validation) return null;
        return { ok: false, status: validation.status, error: validation.error };
      }

      // Phase 2: Transfer on chain
      if (!deps.transferDem) {
        return { ok: false, status: 0, error: "Chain transfer not available (no sdkBridge)" };
      }

      try {
        const { recipient } = validation.data;
        const result = await deps.transferDem(recipient, amount, `tip:${postTxHash}`);
        return { ok: true, data: { txHash: result.txHash, validated: true } };
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async react(txHash, type) {
      return deps.apiClient.react(txHash, type);
    },

    async getReactions(txHash) {
      return deps.apiClient.getReactionCounts(txHash);
    },

    async getTipStats(postTxHash) {
      return deps.apiClient.getTipStats(postTxHash);
    },

    async getAgentTipStats(address) {
      return deps.apiClient.getAgentTipStats(address);
    },

    async placeBet(asset, price, opts) {
      if (!deps.transferDem) {
        return { ok: false, status: 0, error: "Chain transfer not available (no sdkBridge)" };
      }

      try {
        const horizon = opts?.horizon ?? "1h";
        // Resolve pool address from API — each asset/horizon has its own pool
        const poolResult = await deps.apiClient.getBettingPool(asset, horizon);
        if (!poolResult || !poolResult.ok) {
          return { ok: false, status: 0, error: "Failed to resolve betting pool" };
        }

        const memo = `HIVE_BET:${asset}:${price}:${horizon}`;
        // 5 DEM to the pool address
        const result = await deps.transferDem(poolResult.data.poolAddress, 5, memo);
        return { ok: true, data: { txHash: result.txHash } };
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
