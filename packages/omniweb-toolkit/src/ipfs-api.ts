/**
 * IPFS API — decentralized file storage via Demos IPFS integration.
 *
 * Wraps @kynesyslabs/demosdk/ipfs. Provides upload (add+pin), pin
 * existing CIDs, and unpin. Files stored on IPFS via Demos network.
 *
 * Pricing: Max 2GB per content. Costs DEM based on size.
 */

import type { Demos } from "@kynesyslabs/demosdk/websdk";

export interface IPFSAPI {
  /** Upload content to IPFS (auto-pinned). Returns txHash on chain confirmation. */
  upload(content: string | Uint8Array, opts?: { filename?: string }): Promise<{ ok: boolean; txHash?: string; error?: string }>;
  /** Pin an existing CID on the Demos IPFS network. */
  pin(cid: string, opts?: { duration?: number }): Promise<{ ok: boolean; txHash?: string; error?: string }>;
  /** Unpin a CID. */
  unpin(cid: string): Promise<{ ok: boolean; txHash?: string; error?: string }>;
}

export function createIPFSAPI(demos: Demos): IPFSAPI {
  let ipfsModule: any = null;

  async function getIPFSModule() {
    if (!ipfsModule) {
      // IPFS subpath may not be in SDK's package.json exports —
      // construct the path manually to bypass module resolution errors.
      const sdkPath = "@kynesyslabs/demosdk";
      const mod: any = await import(/* @vite-ignore */ `${sdkPath}/ipfs`);
      ipfsModule = mod.IPFSOperations ?? mod.default?.IPFSOperations ?? mod;
    }
    return ipfsModule;
  }

  async function submitPayload(payload: unknown): Promise<{ ok: boolean; txHash?: string; error?: string }> {
    try {
      const tx = await demos.store(payload as Uint8Array);
      const confirmed = await demos.confirm(tx);
      await demos.broadcast(confirmed);
      const txHash = (confirmed as any)?.response?.data?.transaction?.hash ?? "pending";
      return { ok: true, txHash };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  return {
    async upload(content, opts) {
      try {
        const IPFSOperations = await getIPFSModule();
        const payload = IPFSOperations.createAddPayload(content, { filename: opts?.filename });
        return submitPayload(payload);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async pin(cid, opts) {
      try {
        const IPFSOperations = await getIPFSModule();
        const payload = IPFSOperations.createPinPayload(cid, { duration: opts?.duration });
        return submitPayload(payload);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async unpin(cid) {
      try {
        const IPFSOperations = await getIPFSModule();
        const payload = IPFSOperations.createUnpinPayload(cid);
        return submitPayload(payload);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}
