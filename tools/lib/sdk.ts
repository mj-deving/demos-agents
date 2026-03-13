/**
 * SDK initialization and API helpers for Sentinel tools.
 *
 * Provides wallet connection factory and SuperColony API call wrapper.
 * Extracted from skills/supercolony/scripts/supercolony.ts patterns.
 *
 * Runtime: Node.js + tsx (NOT bun — SDK crashes on bun NAPI)
 */

import { webcrypto } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

// Node 18 polyfill
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

import { Demos } from "@kynesyslabs/demosdk/websdk";

// ── Constants ──────────────────────────────────────

export const RPC_URL = "https://demosnode.discus.sh/";
export const SUPERCOLONY_API = "https://www.supercolony.ai";
let logAgentName = process.env.AGENT_NAME || "agent";

// ── Wallet ─────────────────────────────────────────

/**
 * XDG credentials path — checked before legacy .env files.
 */
const XDG_CREDENTIALS = resolve(homedir(), ".config/demos/credentials");

/**
 * Parse DEMOS_MNEMONIC from file content.
 * Handles double-quoted, single-quoted, and unquoted values.
 * Trims whitespace from the result.
 */
function parseMnemonic(content: string, filePath: string): string {
  // Process line-by-line, skip comments. Anchored to line start to avoid
  // matching commented-out lines like "# DEMOS_MNEMONIC=old".
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Double-quoted: DEMOS_MNEMONIC="value"
    const dq = trimmed.match(/^DEMOS_MNEMONIC="(.+?)"/);
    if (dq) return dq[1].trim();

    // Single-quoted: DEMOS_MNEMONIC='value'
    const sq = trimmed.match(/^DEMOS_MNEMONIC='(.+?)'/);
    if (sq) return sq[1].trim();

    // Unquoted: DEMOS_MNEMONIC=value (capture full value, strip inline # comments)
    const uq = trimmed.match(/^DEMOS_MNEMONIC=(.+)/);
    if (uq) {
      // Strip inline comments: "word1 word2 # comment" → "word1 word2"
      const val = uq[1].replace(/\s+#\s.*$/, "").trim();
      if (val) return val;
    }
  }

  throw new Error(`No DEMOS_MNEMONIC found in ${filePath}`);
}

/**
 * Load mnemonic from credentials file or .env file.
 * Resolution: explicit envPath (if non-default) → XDG → legacy envPath.
 * Explicit --env flag always wins; XDG is fallback for default paths.
 */
export function loadMnemonic(envPath: string): string {
  const legacy = resolve(envPath.replace(/^~/, homedir()));
  const isExplicit = envPath !== ".env" && existsSync(legacy);

  // Explicit --env flag always wins
  if (isExplicit) {
    return parseMnemonic(readFileSync(legacy, "utf-8"), legacy);
  }

  // XDG path is preferred default
  if (existsSync(XDG_CREDENTIALS)) {
    return parseMnemonic(readFileSync(XDG_CREDENTIALS, "utf-8"), XDG_CREDENTIALS);
  }

  // Legacy fallback
  if (!existsSync(legacy)) {
    throw new Error(`No credentials file at ${XDG_CREDENTIALS} or ${legacy}`);
  }
  return parseMnemonic(readFileSync(legacy, "utf-8"), legacy);
}

/**
 * Connect wallet and return Demos instance + address.
 * Factory pattern — each call creates a fresh instance.
 */
export async function connectWallet(envPath: string): Promise<{ demos: Demos; address: string }> {
  const mnemonic = loadMnemonic(envPath);
  const demos = new Demos();
  await demos.connect(RPC_URL);
  const address = await demos.connectWallet(mnemonic);
  return { demos, address };
}

// ── API Helpers ────────────────────────────────────

/**
 * Make an API call to SuperColony.
 * Handles JSON parsing, error wrapping, and auth header injection.
 */
export async function apiCall(
  path: string,
  token: string | null,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  const url = path.startsWith("http") ? path : `${SUPERCOLONY_API}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  // Only attach bearer token to SuperColony API requests — prevents
  // accidental token exfiltration to arbitrary URLs passed via path param.
  // Uses URL origin check (not string prefix) to block subdomain spoofing
  // like "supercolony.ai.evil.test".
  if (token) {
    let isSuperColony = !path.startsWith("http"); // relative paths are always SC
    if (!isSuperColony) {
      try {
        const origin = new URL(url).origin;
        isSuperColony = origin === "https://www.supercolony.ai" || origin === "https://supercolony.ai";
      } catch { /* malformed URL — don't attach token */ }
    }
    if (isSuperColony) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 3000; // 3s, 6s, 12s exponential backoff

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers });

      // Retry on 502 Bad Gateway — GET only (POST/PUT may have side effects)
      const method = (options.method || "GET").toUpperCase();
      if (res.status === 502 && attempt < MAX_RETRIES && method === "GET") {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        info(`502 Bad Gateway on ${path} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay / 1000}s`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { ok: res.ok, status: res.status, data };
    } catch (err: any) {
      // Network-level errors are NOT retried — only 502 responses
      return { ok: false, status: 0, data: err.message };
    }
  }

  // Should never reach here, but satisfy TypeScript
  return { ok: false, status: 502, data: "Max retries exceeded on 502" };
}

/**
 * Log info to stderr (keeps stdout clean for JSON output).
 */
export function setLogAgent(agentName: string): void {
  const trimmed = agentName.trim();
  if (!trimmed) return;
  logAgentName = trimmed;
}

/**
 * Log info to stderr (keeps stdout clean for JSON output).
 */
export function info(msg: string, agentName: string = logAgentName): void {
  console.error(`[${agentName}] ${msg}`);
}
