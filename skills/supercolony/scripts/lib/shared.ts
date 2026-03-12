/**
 * Shared helpers for SuperColony skill scripts.
 *
 * This module intentionally reuses canonical implementations from tools/lib
 * to avoid maintaining duplicate auth/sdk logic in multiple script files.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { Demos } from "@kynesyslabs/demosdk/websdk";

import {
  loadMnemonic as canonicalLoadMnemonic,
  connectWallet as canonicalConnectWallet,
  apiCall as canonicalApiCall,
} from "../../../../tools/lib/sdk.js";
import {
  ensureAuth as canonicalEnsureAuth,
  loadAuthCache as canonicalLoadAuthCache,
} from "../../../../tools/lib/auth.js";

const XDG_CREDENTIALS = resolve(homedir(), ".config/demos/credentials");

export interface AuthCacheEntry {
  token: string;
  expiresAt: string;
  address: string;
}

/**
 * Resolve credentials path with XDG fallback.
 * Explicit non-default paths are returned as-is.
 */
export function resolveCredentialPath(preferredPath: string, defaultPath: string): string {
  const normalizedPreferred = resolve(preferredPath.replace(/^~/, homedir()));
  const normalizedDefault = resolve(defaultPath.replace(/^~/, homedir()));

  if (normalizedPreferred !== normalizedDefault) {
    return normalizedPreferred;
  }
  if (existsSync(XDG_CREDENTIALS)) {
    return XDG_CREDENTIALS;
  }
  return normalizedPreferred;
}

/**
 * Load mnemonic from credentials file.
 * Delegates parsing rules to canonical tools/lib implementation.
 */
export function loadMnemonic(envPath: string): string {
  return canonicalLoadMnemonic(envPath);
}

/**
 * Connect wallet via canonical tools/lib implementation.
 */
export async function connectWallet(envPath: string): Promise<{ demos: Demos; address: string }> {
  return canonicalConnectWallet(envPath);
}

/**
 * Authenticated API wrapper via canonical tools/lib implementation.
 */
export async function apiCall(
  path: string,
  token: string | null,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  return canonicalApiCall(path, token, options);
}

/**
 * Challenge-response auth + cache via canonical tools/lib implementation.
 */
export async function ensureAuth(demos: Demos, address: string, forceRefresh = false): Promise<string> {
  return canonicalEnsureAuth(demos, address, forceRefresh);
}

/**
 * Read auth cache entry for a wallet address.
 */
export function loadAuthCache(address?: string): AuthCacheEntry | null {
  return canonicalLoadAuthCache(address);
}

