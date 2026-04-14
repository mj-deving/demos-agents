/**
 * Chain API — core Demos blockchain operations.
 *
 * Wraps the SDK bridge for common chain operations: transfers,
 * balance checks, message signing, transaction queries.
 * These are Demos chain primitives, not SuperColony-specific.
 */

import type { SdkBridge } from "../../../src/toolkit/sdk-bridge.js";
import type { Demos } from "@kynesyslabs/demosdk/websdk";

export interface ChainAPI {
  /** Transfer DEM to an address with optional memo. */
  transfer(to: string, amount: number, memo?: string): Promise<{ ok: boolean; txHash?: string; error?: string }>;
  /** Get DEM balance for an address. */
  getBalance(address: string): Promise<{ ok: boolean; balance?: string; error?: string }>;
  /** Sign a message with the connected wallet. */
  signMessage(message: string): Promise<{ ok: boolean; signature?: unknown; error?: string }>;
  /** Verify a signed message. */
  verifyMessage(message: string, signature: string, publicKey: string): Promise<boolean>;
  /** Get the connected wallet address. */
  getAddress(): string;
  /** Get current block number. */
  getBlockNumber(): Promise<number | null>;
}

export function createChainAPI(demos: Demos, sdkBridge: SdkBridge, address: string): ChainAPI {
  return {
    async transfer(to, amount, memo) {
      // Amount validation — raw transfer, money-moving path
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, error: "Amount must be a positive finite number" };
      }
      if (amount > 1000) {
        return { ok: false, error: `Amount ${amount} exceeds safety ceiling of 1000 DEM per transfer` };
      }
      try {
        const result = await sdkBridge.transferDem(to, amount, memo ?? "");
        return { ok: true, txHash: result.txHash };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async getBalance(addr) {
      try {
        const info = await demos.getAddressInfo(addr);
        return { ok: true, balance: String((info as any)?.balance ?? 0) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async signMessage(message) {
      try {
        const result = await demos.signMessage(message);
        return { ok: true, signature: result };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async verifyMessage(message, signature, publicKey) {
      try {
        return await demos.verifyMessage(message, signature, publicKey);
      } catch {
        return false;
      }
    },

    getAddress() {
      return address;
    },

    async getBlockNumber() {
      try {
        return await demos.getLastBlockNumber();
      } catch {
        return null;
      }
    },
  };
}
