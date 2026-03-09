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

// ── Wallet ─────────────────────────────────────────

/**
 * Load mnemonic from .env file.
 * Looks for DEMOS_MNEMONIC="..." in the file.
 */
export function loadMnemonic(envPath: string): string {
  const resolved = resolve(envPath.replace(/^~/, homedir()));
  if (!existsSync(resolved)) {
    throw new Error(`No .env file at ${resolved}`);
  }
  const content = readFileSync(resolved, "utf-8");
  const match = content.match(/DEMOS_MNEMONIC="(.+?)"/);
  if (!match) {
    throw new Error("No DEMOS_MNEMONIC found in .env");
  }
  return match[1];
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = path.startsWith("http") ? path : `${SUPERCOLONY_API}${path}`;

  try {
    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err: any) {
    return { ok: false, status: 0, data: err.message };
  }
}

/**
 * Log info to stderr (keeps stdout clean for JSON output).
 */
export function info(msg: string): void {
  console.error(`[sentinel] ${msg}`);
}
