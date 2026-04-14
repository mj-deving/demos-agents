/**
 * Identity API — Demos chain identity linking and lookup.
 *
 * Wraps identity.ts (write: link Twitter/GitHub) and chain-identity.ts
 * (read: lookup by platform/address). Uses RPC-direct to bypass the
 * SDK's abstraction barrel (NAPI SIGSEGV on import).
 */

import type { Demos } from "@kynesyslabs/demosdk/websdk";

export interface IdentityAPI {
  /** Link a Web2 identity (Twitter/GitHub) to your Demos address. Requires proof URL. */
  link(platform: "twitter" | "github", proofUrl: string): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  /** Look up Demos accounts linked to a social identity. */
  lookup(platform: "twitter" | "github" | "discord" | "telegram", username: string): Promise<{ ok: boolean; data?: Array<{ pubkey: string }>; error?: string }>;
  /** Get all identities linked to a Demos address. */
  getIdentities(address?: string): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  /** Generate a proof payload for Web2 identity verification. */
  createProof(): Promise<{ ok: boolean; data?: string; error?: string }>;
}

export function createIdentityAPI(demos: Demos, rpcUrl: string, address?: string): IdentityAPI {
  let identityModule: typeof import("../../../src/lib/auth/identity.js") | null = null;
  let chainIdentityModule: typeof import("../../../src/toolkit/supercolony/chain-identity.js") | null = null;

  async function getIdentityModule() {
    if (!identityModule) identityModule = await import("../../../src/lib/auth/identity.js");
    return identityModule;
  }

  async function getChainIdentityModule() {
    if (!chainIdentityModule) chainIdentityModule = await import("../../../src/toolkit/supercolony/chain-identity.js");
    return chainIdentityModule;
  }

  return {
    async link(platform, proofUrl) {
      try {
        const mod = await getIdentityModule();
        if (platform === "twitter") return mod.addTwitterIdentity(demos, proofUrl);
        return mod.addGithubIdentity(demos, proofUrl);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async lookup(platform, username) {
      try {
        const mod = await getChainIdentityModule();
        const accounts = await mod.lookupByWeb2(rpcUrl, platform, username);
        if (!accounts || accounts.length === 0) {
          return { ok: false, error: `No Demos account linked to ${platform}:${username}` };
        }
        return { ok: true, data: accounts.map(a => ({ pubkey: a.pubkey })) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async getIdentities(addr) {
      try {
        const mod = await getIdentityModule();
        const result = await mod.getIdentities(rpcUrl, addr ?? address ?? "");
        return result;
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async createProof() {
      try {
        const mod = await getIdentityModule();
        const proof = await mod.createWeb2ProofPayload(demos);
        return { ok: true, data: proof };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}
