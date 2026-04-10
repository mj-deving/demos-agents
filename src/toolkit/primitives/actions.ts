/**
 * Actions domain — tip, react, bet, and related stats.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { ApiResult } from "../supercolony/types.js";
import type { ActionsPrimitives } from "./types.js";
import { simulateTransaction } from "../chain/tx-simulator.js";

interface ActionsDeps {
  apiClient: SuperColonyApiClient;
  transferDem?: (to: string, amount: number, memo: string) => Promise<{ txHash: string }>;
  /** RPC URL for transaction simulation (optional — skips simulation when absent) */
  rpcUrl?: string;
  /** Sender address for transaction simulation */
  fromAddress?: string;
}

export function createActionsPrimitives(deps: ActionsDeps): ActionsPrimitives {
  return {
    async tip(postTxHash, amount): Promise<ApiResult<{ txHash: string; validated: boolean }>> {
      // Normalize amount: round to integer, clamp 1-10 DEM (API requires integer amounts)
      const normalizedAmount = Math.min(10, Math.max(1, Math.round(amount)));

      // Phase 1: Validate via API (spam limits, indexer attribution)
      const validation = await deps.apiClient.initiateTip(postTxHash, normalizedAmount);
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

        // TX Simulation Gate — dry-run before spending real DEM
        if (deps.rpcUrl && deps.fromAddress) {
          // Convert DEM amount to wei-equivalent hex for accurate balance check
          const valueWei = BigInt(normalizedAmount) * 10n ** 18n;
          const sim = await simulateTransaction({
            rpcUrl: deps.rpcUrl,
            from: deps.fromAddress,
            to: recipient,
            data: "0x",
            value: `0x${valueWei.toString(16)}`,
            // failOpen defaults to false — tip is a money-moving path, must fail-closed
          });
          if (!sim.success) {
            return { ok: false, status: 0, error: `Simulation rejected tip: ${sim.error}` };
          }
          if (sim.warning) {
            console.warn(`[actions:tip] Simulation warning: ${sim.warning}`);
          }
        }

        const result = await deps.transferDem(recipient, normalizedAmount, `tip:${postTxHash}`);
        return { ok: true, data: { txHash: result.txHash, validated: true } };
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
    },

    /** React to a post. Auth enforced server-side (API returns 401 without token).
     *  Unlike the legacy react.ts tool, this does NOT check auth locally —
     *  consistent with all other toolkit primitives that delegate to apiClient. */
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

    async initiateTip(postTxHash, amount) {
      return deps.apiClient.initiateTip(postTxHash, amount);
    },

    async placeBet(asset, price, opts) {
      if (!deps.transferDem) {
        return { ok: false, status: 0, error: "Chain transfer not available (no sdkBridge)" };
      }

      // Input validation (Codex fix #2 — prevent malformed memos)
      if (!asset || typeof asset !== "string" || asset.includes(":")) {
        return { ok: false, status: 0, error: "Invalid asset — must be non-empty string without colons" };
      }
      if (!Number.isFinite(price) || price <= 0) {
        return { ok: false, status: 0, error: "Invalid price — must be a positive finite number" };
      }
      const VALID_HORIZONS = ["10m", "30m", "4h", "24h"] as const;
      const horizon = opts?.horizon ?? "30m";
      if (!VALID_HORIZONS.includes(horizon as any)) {
        return { ok: false, status: 0, error: `Invalid horizon "${horizon}" — must be one of: ${VALID_HORIZONS.join(", ")}` };
      }

      try {
        // Resolve pool address from API — each asset/horizon has its own pool
        const poolResult = await deps.apiClient.getBettingPool(asset, horizon);
        // Preserve null vs structured error distinction (Codex fix #3)
        if (!poolResult) return null;
        if (!poolResult.ok) {
          return { ok: false, status: poolResult.status, error: `Failed to resolve betting pool: ${poolResult.error}` };
        }

        // Validate pool address and echo-check (Codex fix #1 — don't trust API blindly)
        const poolAddress = poolResult.data.poolAddress;
        if (!poolAddress || typeof poolAddress !== "string" || poolAddress.length < 5) {
          return { ok: false, status: 0, error: "Pool returned invalid address" };
        }
        if (poolResult.data.asset !== asset) {
          return { ok: false, status: 0, error: `Pool asset mismatch: requested ${asset}, got ${poolResult.data.asset}` };
        }

        // TX Simulation Gate — dry-run before spending real DEM on bet
        if (deps.rpcUrl && deps.fromAddress) {
          // 5 DEM bet amount → wei-equivalent hex
          const betValueWei = 5n * 10n ** 18n;
          const sim = await simulateTransaction({
            rpcUrl: deps.rpcUrl,
            from: deps.fromAddress,
            to: poolAddress,
            data: "0x",
            value: `0x${betValueWei.toString(16)}`,
            // failOpen defaults to false — bet is a money-moving path, must fail-closed
          });
          if (!sim.success) {
            return { ok: false, status: 0, error: `Simulation rejected bet: ${sim.error}` };
          }
          if (sim.warning) {
            console.warn(`[actions:placeBet] Simulation warning: ${sim.warning}`);
          }
        }

        const memo = `HIVE_BET:${asset}:${price}:${horizon}`;
        // 5 DEM to the pool address
        const result = await deps.transferDem(poolAddress, 5, memo);
        return { ok: true, data: { txHash: result.txHash } };
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
