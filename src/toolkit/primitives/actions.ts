/**
 * Actions domain — tip (2-phase: API validation + chain transfer).
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
  };
}
