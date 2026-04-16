/**
 * Actions domain — tip, react, bet, and related stats.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { ApiResult } from "../supercolony/types.js";
import type { ActionsPrimitives } from "./types.js";
import { simulateTransaction } from "../chain/tx-simulator.js";
import {
  buildBetMemo,
  buildHigherLowerMemo,
  normalizeAsset,
  normalizeDirection,
  normalizeHorizon,
  normalizePredictedPrice,
} from "../supercolony/bet-memos.js";

interface ActionsDeps {
  apiClient: SuperColonyApiClient;
  transferDem?: (to: string, amount: number, memo: string) => Promise<{ txHash: string }>;
  /** RPC URL for transaction simulation (optional — skips simulation when absent) */
  rpcUrl?: string;
  /** Sender address for transaction simulation */
  fromAddress?: string;
}

export function createActionsPrimitives(deps: ActionsDeps): ActionsPrimitives {
  function registrationFailure(
    txHash: string,
    memo: string,
    amount: number,
    registration: ApiResult<unknown>,
  ) {
    const registrationError =
      registration === null
        ? "Registration endpoint unavailable after transfer"
        : registration.ok
          ? undefined
          : `Registration failed (${registration.status}): ${registration.error}`;

    return {
      ok: true as const,
      data: { txHash, memo, amount, registered: false, registrationError },
    };
  }

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

        const result = await deps.transferDem(recipient, normalizedAmount, `HIVE_TIP:${postTxHash}`);
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

      let normalizedAsset: string;
      let normalizedPrice: number;
      let horizon: import("../supercolony/types.js").BettingHorizon;
      let memo: string;
      try {
        normalizedAsset = normalizeAsset(asset);
        normalizedPrice = normalizePredictedPrice(price);
        horizon = normalizeHorizon(opts?.horizon);
        memo = buildBetMemo(normalizedAsset, normalizedPrice, { horizon });
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }

      try {
        // Resolve pool address from API — each asset/horizon has its own pool
        const poolResult = await deps.apiClient.getBettingPool(normalizedAsset, horizon);
        if (!poolResult) return null;
        if (!poolResult.ok) {
          return { ok: false, status: poolResult.status, error: `Failed to resolve betting pool: ${poolResult.error}` };
        }

        const poolAddress = poolResult.data.poolAddress;
        if (!poolAddress || typeof poolAddress !== "string" || poolAddress.length < 5) {
          return { ok: false, status: 0, error: "Pool returned invalid address" };
        }
        if (poolResult.data.asset !== normalizedAsset) {
          return { ok: false, status: 0, error: `Pool asset mismatch: requested ${normalizedAsset}, got ${poolResult.data.asset}` };
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

        const result = await deps.transferDem(poolAddress, 5, memo);
        const registration = await deps.apiClient.registerBet(
          result.txHash,
          normalizedAsset,
          normalizedPrice,
          { horizon },
        );
        if (registration === null || !registration.ok) {
          return registrationFailure(result.txHash, memo, 5, registration);
        }
        return { ok: true, data: { txHash: result.txHash, memo, amount: 5, registered: true } };
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async placeHL(asset, direction, opts) {
      if (!deps.transferDem) {
        return { ok: false, status: 0, error: "Chain transfer not available (no sdkBridge)" };
      }

      let normalizedAsset: string;
      let normalizedDirection: import("../supercolony/types.js").BetWriteDirection;
      let horizon: import("../supercolony/types.js").BettingHorizon;
      let memo: string;
      try {
        normalizedAsset = normalizeAsset(asset);
        normalizedDirection = normalizeDirection(direction);
        horizon = normalizeHorizon(opts?.horizon);
        memo = buildHigherLowerMemo(normalizedAsset, normalizedDirection, { horizon });
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }

      const rawAmount = opts?.amount ?? 1;
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        return { ok: false, status: 0, error: "Invalid amount — must be a positive finite number" };
      }
      // Live write proving showed the current higher/lower path requires integer DEM amounts.
      const amount = Math.min(5, Math.max(1, Math.round(rawAmount)));

      try {
        const poolResult = await deps.apiClient.getHigherLowerPool(normalizedAsset, horizon);
        if (!poolResult) return null;
        if (!poolResult.ok) {
          return { ok: false, status: poolResult.status, error: `Failed to resolve pool: ${poolResult.error}` };
        }

        const poolAddress = poolResult.data.poolAddress;
        if (!poolAddress || typeof poolAddress !== "string" || poolAddress.length < 5) {
          return { ok: false, status: 0, error: "Pool returned invalid address" };
        }
        if (poolResult.data.asset !== normalizedAsset) {
          return { ok: false, status: 0, error: `Pool asset mismatch: requested ${normalizedAsset}, got ${poolResult.data.asset}` };
        }

        const result = await deps.transferDem(poolAddress, amount, memo);
        const registration = await deps.apiClient.registerHigherLowerBet(
          result.txHash,
          normalizedAsset,
          normalizedDirection,
          { horizon },
        );
        if (registration === null || !registration.ok) {
          return registrationFailure(result.txHash, memo, amount, registration);
        }
        return { ok: true, data: { txHash: result.txHash, memo, amount, registered: true } };
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async registerBet(txHash, asset, predictedPrice, opts) {
      let normalizedAsset: string;
      let normalizedPrice: number;
      let horizon: import("../supercolony/types.js").BettingHorizon;
      try {
        normalizedAsset = normalizeAsset(asset);
        normalizedPrice = normalizePredictedPrice(predictedPrice);
        horizon = normalizeHorizon(opts?.horizon);
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
      if (!txHash || typeof txHash !== "string") {
        return { ok: false, status: 0, error: "txHash is required" };
      }
      return deps.apiClient.registerBet(txHash, normalizedAsset, normalizedPrice, { horizon });
    },

    async registerHL(txHash, asset, direction, opts) {
      let normalizedAsset: string;
      let normalizedDirection: import("../supercolony/types.js").BetWriteDirection;
      let horizon: import("../supercolony/types.js").BettingHorizon;
      try {
        normalizedAsset = normalizeAsset(asset);
        normalizedDirection = normalizeDirection(direction);
        horizon = normalizeHorizon(opts?.horizon);
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
      if (!txHash || typeof txHash !== "string") {
        return { ok: false, status: 0, error: "txHash is required" };
      }
      return deps.apiClient.registerHigherLowerBet(txHash, normalizedAsset, normalizedDirection, { horizon });
    },

    async registerEthBinaryBet(txHash) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        return { ok: false, status: 0, error: "txHash must be a 0x-prefixed 32-byte hex string" };
      }
      return deps.apiClient.registerEthBinaryBet(txHash);
    },
  };
}
