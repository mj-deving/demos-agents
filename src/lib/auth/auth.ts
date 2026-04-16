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
import { apiCall, info } from "../network/sdk.js";

// ── Constants ──────────────────────────────────────

const AUTH_CACHE_PATH = resolve(homedir(), ".supercolony-auth.json");
const AUTH_REFRESH_MARGIN_MS = 60 * 60 * 1000;

// ── Types ──────────────────────────────────────────

interface AuthCacheEntry {
  token: string;
  expiresAt: string;
}

/** On-disk format: { [address]: { token, expiresAt } } */
type AuthCacheFile = Record<string, AuthCacheEntry>;

interface AuthChallengeResponse {
  challenge?: string;
  message?: string;
}

interface AuthVerifyResponse {
  token?: string;
  expiresAt?: string | number;
}

function getErrorDetail(err: unknown): string {
  if (err instanceof Error && typeof err.cause === "object" && err.cause !== null) {
    const cause = err.cause as Record<string, unknown>;
    if (typeof cause.code === "string" && cause.code) return cause.code;
  }
  return err instanceof Error ? err.message : String(err);
}

function normalizeExpiresAt(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return new Date(numeric).toISOString();
    }
    return null;
  }

  const parsed = new Date(trimmed).getTime();
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function readCacheEntry(
  address: string,
  entry: { token?: unknown; expiresAt?: unknown } | null | undefined,
): { token: string; expiresAt: string; address: string } | null {
  if (!entry || typeof entry.token !== "string") {
    return null;
  }

  const normalizedExpiresAt = normalizeExpiresAt(entry.expiresAt);
  if (!normalizedExpiresAt) {
    return null;
  }

  const expiry = new Date(normalizedExpiresAt).getTime();
  if (!Number.isFinite(expiry) || Date.now() > expiry - AUTH_REFRESH_MARGIN_MS) {
    return null;
  }

  return { token: entry.token, expiresAt: normalizedExpiresAt, address };
}

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
      const entry = readCacheEntry(address, raw[address] as AuthCacheEntry | undefined);
      if (entry) return entry;
    }

    // Fall back to legacy top-level fields (pure legacy or mixed format)
    if (raw.token && raw.address && raw.expiresAt) {
      if (address && raw.address !== address) return null;
      return readCacheEntry(String(raw.address), raw as AuthCacheEntry);
    }

    return null;
  } catch {
    return null;
  }
}

function saveAuthCache(address: string, token: string, expiresAt: string | number): void {
  const normalizedExpiresAt = normalizeExpiresAt(expiresAt);
  if (!normalizedExpiresAt) {
    throw new Error("Cannot persist auth cache without a valid expiresAt timestamp");
  }

  let data: AuthCacheFile = {};
  if (existsSync(AUTH_CACHE_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(AUTH_CACHE_PATH, "utf-8"));
      // Preserve ALL existing namespaced entries (skip legacy top-level keys)
      for (const [k, v] of Object.entries(raw)) {
        if (k !== "token" && k !== "address" && k !== "expiresAt" && typeof v === "object" && v !== null) {
          const normalizedEntry = readCacheEntry(k, v as AuthCacheEntry);
          if (normalizedEntry) {
            data[k] = { token: normalizedEntry.token, expiresAt: normalizedEntry.expiresAt };
          }
        }
      }
      // Also migrate legacy entry if present and not already in map
      if (raw.token && raw.address && !data[raw.address]) {
        const normalizedLegacy = readCacheEntry(String(raw.address), raw as AuthCacheEntry);
        if (normalizedLegacy) {
          data[raw.address] = {
            token: normalizedLegacy.token,
            expiresAt: normalizedLegacy.expiresAt,
          };
        }
      }
    } catch { /* start fresh */ }
  }
  data[address] = { token, expiresAt: normalizedExpiresAt };
  // Write both legacy flat format (for skills/supercolony compat) and namespaced map
  const output: Record<string, unknown> = {
    // Legacy fields — consumed by skills/supercolony/scripts/supercolony.ts
    token,
    address,
    expiresAt: normalizedExpiresAt,
    // Namespaced entries — consumed by tools/lib/auth.ts loadAuthCache
    ...data,
  };
  writeFileSync(AUTH_CACHE_PATH, JSON.stringify(output, null, 2), { mode: 0o600 });
}

// ── Auth Flow ──────────────────────────────────────

/**
 * Ensure we have a valid auth token. Uses cache first, then does
 * challenge-response auth if needed.
 *
 * Returns null when the API is unreachable (e.g. DNS failure) —
 * callers should degrade gracefully to chain-only mode.
 */
export async function ensureAuth(
  demos: Demos,
  address: string,
  forceRefresh = false
): Promise<string | null> {
  if (!forceRefresh) {
    const cached = loadAuthCache(address);
    if (cached) {
      info(`Using cached token (expires: ${cached.expiresAt})`);
      return cached.token;
    }
  }

  info("Authenticating...");

  // Get challenge
  let challengeRes;
  try {
    challengeRes = await apiCall<AuthChallengeResponse>(`/api/auth/challenge?address=${address}`, null);
  } catch (err: unknown) {
    // Network-level failure (DNS, timeout, connection refused)
    info(`API unreachable (${getErrorDetail(err)}) — continuing in chain-only mode`);
    return null;
  }
  if (!challengeRes.ok) {
    info(`Auth challenge failed (${challengeRes.status}) — continuing in chain-only mode`);
    return null;
  }

  const { challenge, message } = challengeRes.data;
  if (typeof challenge !== "string" || typeof message !== "string") {
    info("Auth challenge response missing challenge/message — continuing in chain-only mode");
    return null;
  }

  // Sign
  const signature = await demos.signMessage(message);

  // Verify
  let verifyRes;
  try {
    verifyRes = await apiCall<AuthVerifyResponse>("/api/auth/verify", null, {
      method: "POST",
      body: JSON.stringify({
        address,
        challenge,
        signature: signature.data,
        algorithm: signature.type,
      }),
    });
  } catch (err: unknown) {
    info(`Auth verify unreachable (${getErrorDetail(err)}) — continuing in chain-only mode`);
    return null;
  }

  if (!verifyRes.ok || !verifyRes.data.token) {
    info(`Auth verify failed (${verifyRes.status}) — continuing in chain-only mode`);
    return null;
  }

  const token = verifyRes.data.token;
  const expiresAt = verifyRes.data.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  saveAuthCache(address, token, expiresAt);
  const normalizedExpiresAt = normalizeExpiresAt(expiresAt) ?? String(expiresAt);
  info(`Authenticated. Token expires: ${normalizedExpiresAt}`);

  return token;
}
