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

interface AuthCache {
  token: string;
  expiresAt: string;
  address: string;
}

// ── Cache I/O ──────────────────────────────────────

/**
 * Load cached auth token. Returns null if expired or missing.
 */
export function loadAuthCache(): AuthCache | null {
  if (!existsSync(AUTH_CACHE_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(AUTH_CACHE_PATH, "utf-8"));
    // Validate cache shape
    if (!data.token || !data.address || !data.expiresAt) return null;
    // Check if expired (with 5-min buffer)
    const expiry = new Date(data.expiresAt).getTime();
    if (!Number.isFinite(expiry) || Date.now() > expiry - 5 * 60 * 1000) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveAuthCache(cache: AuthCache): void {
  writeFileSync(AUTH_CACHE_PATH, JSON.stringify(cache, null, 2));
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
    const cached = loadAuthCache();
    if (cached && cached.address === address) {
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

  saveAuthCache({ token, expiresAt, address });
  info(`Authenticated. Token expires: ${expiresAt}`);

  return token;
}
