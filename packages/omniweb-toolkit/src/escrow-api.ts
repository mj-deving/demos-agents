/**
 * Escrow API — trustless tipping to social identities.
 *
 * Wraps @kynesyslabs/demosdk/escrow. Enables tipping users who don't
 * have a Demos wallet yet — DEM is held in escrow at a deterministic
 * address until the recipient links their identity and claims it.
 *
 * Flow: sendToIdentity → DEM held at escrow address →
 *       recipient links identity → claimEscrow → DEM transferred.
 *       If unclaimed after expiry → sender calls refundExpired.
 */

import type { Demos } from "@kynesyslabs/demosdk/websdk";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type EscrowPlatform = "twitter" | "github" | "telegram";

/** Maximum DEM per escrow send (safety ceiling). */
const MAX_ESCROW_AMOUNT = 100;

export interface EscrowAPI {
  /** Send DEM to a social identity. Amount clamped to 0.1-100 DEM. Recipient claims after linking their Demos address. */
  sendToIdentity(platform: EscrowPlatform, username: string, amount: number, opts?: { expiryDays?: number; message?: string }): Promise<{ ok: boolean; txHash?: string; error?: string }>;
  /** Claim DEM sent to your social identity (must link identity first). */
  claimEscrow(platform: EscrowPlatform, username: string): Promise<{ ok: boolean; txHash?: string; error?: string }>;
  /** Refund expired escrow back to sender. */
  refundExpired(platform: EscrowPlatform, username: string): Promise<{ ok: boolean; txHash?: string; error?: string }>;
  /** Check claimable escrows for a social identity. */
  getClaimable(platform: EscrowPlatform, username: string): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  /** Get escrow balance for a social identity. */
  getEscrowBalance(platform: EscrowPlatform, username: string): Promise<{ ok: boolean; data?: unknown; error?: string }>;
}

export function createEscrowAPI(demos: Demos, rpcUrl: string, address?: string): EscrowAPI {
  let escrowModule: any = null;
  let escrowQueriesModule: any = null;
  const require = createRequire(import.meta.url);

  async function getEscrowModule() {
    if (!escrowModule) {
      let mod: any;
      try {
        const sdkEscrowSpecifier = "@kynesyslabs/demosdk" + "/escrow";
        mod = await import(/* @vite-ignore */ sdkEscrowSpecifier);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isMissingEscrowExport =
          message.includes("./escrow") &&
          (message.includes("not exported") || message.includes("not defined by \"exports\""));
        if (!isMissingEscrowExport) throw error;

        const sdkEntry = require.resolve("@kynesyslabs/demosdk");
        const fallbackEntry = resolve(dirname(sdkEntry), "escrow", "index.js");
        mod = await import(pathToFileURL(fallbackEntry).href);
      }

      escrowModule = mod.EscrowTransaction ?? mod.default?.EscrowTransaction ?? mod;
      escrowQueriesModule = mod.EscrowQueries ?? mod.default?.EscrowQueries;
    }
    return { EscrowTransaction: escrowModule, EscrowQueries: escrowQueriesModule };
  }

  /** Submit a transaction through the store→confirm→broadcast pipeline. */
  async function submitTx(tx: any): Promise<{ ok: boolean; txHash?: string; error?: string }> {
    try {
      const confirmed = await demos.confirm(tx);
      await demos.broadcast(confirmed);
      return { ok: true, txHash: (confirmed as any)?.response?.data?.transaction?.hash ?? "pending" };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  return {
    async sendToIdentity(platform, username, amount, opts) {
      // Amount validation — money-moving path, fail-closed
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, error: "Amount must be a positive finite number" };
      }
      if (amount > MAX_ESCROW_AMOUNT) {
        return { ok: false, error: `Amount ${amount} exceeds maximum ${MAX_ESCROW_AMOUNT} DEM per escrow send` };
      }
      try {
        const { EscrowTransaction } = await getEscrowModule();
        const tx = await EscrowTransaction.sendToIdentity(demos, platform, username, amount, opts);
        return submitTx(tx);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async claimEscrow(platform, username) {
      try {
        const { EscrowTransaction } = await getEscrowModule();
        const tx = await EscrowTransaction.claimEscrow(demos, platform, username);
        return submitTx(tx);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async refundExpired(platform, username) {
      try {
        const { EscrowTransaction } = await getEscrowModule();
        const tx = await EscrowTransaction.refundExpiredEscrow(demos, platform, username);
        return submitTx(tx);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async getClaimable(platform, username) {
      try {
        const { EscrowQueries } = await getEscrowModule();
        if (!EscrowQueries) return { ok: false, error: "EscrowQueries not available in SDK" };
        if (!address) return { ok: false, error: "Connected address unavailable for claimable escrow lookup" };
        const result = await EscrowQueries.getClaimableEscrows(demos, address);
        const filtered = Array.isArray(result)
          ? result.filter((entry: any) => entry?.platform === platform && entry?.username === username)
          : result;
        return { ok: true, data: filtered };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async getEscrowBalance(platform, username) {
      try {
        const { EscrowQueries } = await getEscrowModule();
        if (!EscrowQueries) return { ok: false, error: "EscrowQueries not available in SDK" };
        const result = await EscrowQueries.getEscrowBalance(demos, platform, username);
        return { ok: true, data: result };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}
