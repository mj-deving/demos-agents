/**
 * Auth token cache management for Sentinel tools.
 *
 * Reads/writes the same ~/.supercolony-auth.json cache that
 * supercolony.ts uses. Challenge-response auth via SuperColony API.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { Demos } from "@kynesyslabs/demosdk/websdk";
import { apiCall, info } from "./sdk.js";

// ── Constants ──────────────────────────────────────

const AUTH_CACHE_PATH = resolve(homedir(), ".supercolony-auth.json");

// ── Types ──────────────────────────────────────────

interface AuthCacheEntry {
  token: string;
  expiresAt: string;
}

/** On-disk format: { [address]: { token, expiresAt } } */
type AuthCacheFile = Record<string, AuthCacheEntry>;

// ── Cache I/O ──────────────────────────────────────

/**
 * Load cached auth token for a specific address. Returns null if expired or missing.
 * Cache is namespaced by address to prevent collisions between agents.
 */
export function loadAuthCache(address?: string): { token: string; expiresAt: string; address: string } | null {
  if (!existsSync(AUTH_CACHE_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(AUTH_CACHE_PATH, "utf-8"));

    // Try namespaced lookup first (works for both mixed and new format)
    if (address) {
      const entry = raw[address] as AuthCacheEntry | undefined;
      if (entry?.token && entry?.expiresAt) {
        const expiry = new Date(entry.expiresAt).getTime();
        if (Number.isFinite(expiry) && Date.now() <= expiry - 5 * 60 * 1000) {
          return { token: entry.token, expiresAt: entry.expiresAt, address };
        }
      }
    }

    // Fall back to legacy top-level fields (pure legacy or mixed format)
    if (raw.token && raw.address && raw.expiresAt) {
      if (address && raw.address !== address) return null;
      const expiry = new Date(raw.expiresAt).getTime();
      if (!Number.isFinite(expiry) || Date.now() > expiry - 5 * 60 * 1000) return null;
      return { token: raw.token, expiresAt: raw.expiresAt, address: raw.address };
    }

    return null;
  } catch {
    return null;
  }
}

function saveAuthCache(address: string, token: string, expiresAt: string): void {
  let data: AuthCacheFile = {};
  if (existsSync(AUTH_CACHE_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(AUTH_CACHE_PATH, "utf-8"));
      // Preserve ALL existing namespaced entries (skip legacy top-level keys)
      for (const [k, v] of Object.entries(raw)) {
        if (k !== "token" && k !== "address" && k !== "expiresAt" && typeof v === "object" && v !== null) {
          data[k] = v as AuthCacheEntry;
        }
      }
      // Also migrate legacy entry if present and not already in map
      if (raw.token && raw.address && !data[raw.address]) {
        data[raw.address] = { token: raw.token, expiresAt: raw.expiresAt };
      }
    } catch { /* start fresh */ }
  }
  data[address] = { token, expiresAt };
  // Write both legacy flat format (for skills/supercolony compat) and namespaced map
  const output: Record<string, any> = {
    // Legacy fields — consumed by skills/supercolony/scripts/supercolony.ts
    token,
    address,
    expiresAt,
    // Namespaced entries — consumed by tools/lib/auth.ts loadAuthCache
    ...data,
  };
  writeFileSync(AUTH_CACHE_PATH, JSON.stringify(output, null, 2), { mode: 0o600 });
}

// ── Auth Flow ──────────────────────────────────────

/**
 * Ensure we have a valid auth token. Uses cache first, then does
 * challenge-response auth if needed.
 */
export async function ensureAuth(
  demos: Demos,
  address: string,
  forceRefresh = false
): Promise<string> {
  if (!forceRefresh) {
    const cached = loadAuthCache(address);
    if (cached) {
      info(`Using cached token (expires: ${cached.expiresAt})`);
      return cached.token;
    }
  }

  info("Authenticating...");

  // Get challenge
  const challengeRes = await apiCall(`/api/auth/challenge?address=${address}`, null);
  if (!challengeRes.ok) {
    throw new Error(`Auth challenge failed (${challengeRes.status}): ${JSON.stringify(challengeRes.data)}`);
  }

  const { challenge, message } = challengeRes.data;

  // Sign
  const signature = await demos.signMessage(message);

  // Verify
  const verifyRes = await apiCall("/api/auth/verify", null, {
    method: "POST",
    body: JSON.stringify({
      address,
      challenge,
      signature: signature.data,
      algorithm: signature.type,
    }),
  });

  if (!verifyRes.ok || !verifyRes.data.token) {
    throw new Error(`Auth verify failed (${verifyRes.status}): ${JSON.stringify(verifyRes.data)}`);
  }

  const token = verifyRes.data.token;
  const expiresAt = verifyRes.data.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  saveAuthCache(address, token, expiresAt);
  info(`Authenticated. Token expires: ${expiresAt}`);

  return token;
}
