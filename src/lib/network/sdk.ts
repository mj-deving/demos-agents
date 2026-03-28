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
import type { SigningAlgorithm } from "@kynesyslabs/demosdk/types/cryptography";

// ── Constants (defaults — overridable via credentials file) ──

export let RPC_URL = "https://demosnode.discus.sh/";
export let SUPERCOLONY_API = "https://www.supercolony.ai";
let logAgentName = process.env.AGENT_NAME || "agent";

// PQC config resolved from credentials file (set by applyConfigOverrides)
let resolvedAlgorithm: SigningAlgorithm | undefined;
let resolvedDualSign: boolean | undefined;

// ── Wallet ─────────────────────────────────────────

/**
 * XDG credentials path — checked before legacy .env files.
 * Per-agent credentials use: ~/.config/demos/credentials-{agent}
 */
const XDG_CREDENTIALS = resolve(homedir(), ".config/demos/credentials");

/**
 * Resolve per-agent credentials path. Falls back to shared credentials.
 * Priority: agent-specific → shared XDG → legacy envPath
 */
function resolveAgentCredentials(agentName?: string): string | null {
  if (agentName) {
    const agentPath = resolve(homedir(), `.config/demos/credentials-${agentName}`);
    if (existsSync(agentPath)) return agentPath;
  }
  if (existsSync(XDG_CREDENTIALS)) return XDG_CREDENTIALS;
  return null;
}

/**
 * Parse a key=value pair from credentials file content.
 * Handles double-quoted, single-quoted, and unquoted values.
 * Skips comment lines. Strips inline comments. Returns undefined if not found.
 */
function parseConfigVar(content: string, key: string): string | undefined {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const dq = trimmed.match(new RegExp(`^${key}="(.+?)"`));
    if (dq) return dq[1].trim();
    const sq = trimmed.match(new RegExp(`^${key}='(.+?)'`));
    if (sq) return sq[1].trim();
    const uq = trimmed.match(new RegExp(`^${key}=(.+)`));
    if (uq) {
      const val = uq[1].replace(/\s+#\s.*$/, "").trim();
      if (val) return val;
    }
  }
  return undefined;
}

/**
 * Parse DEMOS_MNEMONIC from file content. Throws if not found.
 * Delegates to parseConfigVar for consistent key=value parsing.
 */
function parseMnemonic(content: string, filePath: string): string {
  const mnemonic = parseConfigVar(content, "DEMOS_MNEMONIC");
  if (!mnemonic) throw new Error(`No DEMOS_MNEMONIC found in ${filePath}`);
  return mnemonic;
}

/**
 * Apply config overrides from credentials file content.
 * Sets RPC_URL and SUPERCOLONY_API if present in the file.
 */
function applyConfigOverrides(content: string): void {
  const rpc = parseConfigVar(content, "RPC_URL");
  if (rpc) RPC_URL = rpc;
  const api = parseConfigVar(content, "SUPERCOLONY_API");
  if (api) SUPERCOLONY_API = api;

  // PQC algorithm config
  const algo = parseConfigVar(content, "DEMOS_ALGORITHM");
  if (algo && (algo === "falcon" || algo === "ml-dsa" || algo === "ed25519")) {
    resolvedAlgorithm = algo as SigningAlgorithm;
  }
  const dualSign = parseConfigVar(content, "DEMOS_DUAL_SIGN");
  if (dualSign !== undefined) {
    resolvedDualSign = dualSign === "true" || dualSign === "1";
  }
}

/**
 * Load mnemonic from credentials file or .env file.
 * Resolution: explicit envPath → per-agent credentials → shared XDG → legacy envPath.
 * Explicit --env flag always wins; per-agent credentials take priority over shared.
 * Also applies RPC_URL and SUPERCOLONY_API overrides from the file.
 */
export function loadMnemonic(envPath: string, agentName?: string): string {
  const legacy = resolve(envPath.replace(/^~/, homedir()));
  const isExplicit = envPath !== ".env" && existsSync(legacy);

  // Explicit --env flag always wins
  if (isExplicit) {
    const content = readFileSync(legacy, "utf-8");
    applyConfigOverrides(content);
    return parseMnemonic(content, legacy);
  }

  // Per-agent credentials → shared XDG
  const credPath = resolveAgentCredentials(agentName);
  if (credPath) {
    const content = readFileSync(credPath, "utf-8");
    applyConfigOverrides(content);
    return parseMnemonic(content, credPath);
  }

  // Legacy fallback
  if (!existsSync(legacy)) {
    throw new Error(`No credentials file at ${XDG_CREDENTIALS} or ${legacy}`);
  }
  const content = readFileSync(legacy, "utf-8");
  applyConfigOverrides(content);
  return parseMnemonic(content, legacy);
}

/** Wallet connection options for PQC and algorithm selection. */
export interface WalletOptions {
  /** Signing algorithm: "ed25519" (default), "falcon", or "ml-dsa". */
  algorithm?: SigningAlgorithm;
  /** Include ed25519 signature alongside PQC signature (transition period). */
  dualSign?: boolean;
}

/**
 * Connect wallet and return Demos instance + address.
 * Factory pattern — each call creates a fresh instance.
 * When agentName is provided, uses per-agent credentials if available.
 *
 * Supports post-quantum cryptography via Demos SDK:
 * - Set DEMOS_ALGORITHM=falcon in credentials for quantum-proof signing
 * - Set DEMOS_DUAL_SIGN=true during transition period (includes ed25519 + PQC)
 */
export async function connectWallet(
  envPath: string,
  agentName?: string,
  walletOpts?: WalletOptions,
): Promise<{ demos: Demos; address: string }> {
  const mnemonic = loadMnemonic(envPath, agentName);

  // Resolve algorithm: explicit opts > credentials file > default (ed25519)
  const algorithm = walletOpts?.algorithm ?? resolvedAlgorithm ?? "ed25519";
  const dualSign = walletOpts?.dualSign ?? resolvedDualSign ?? false;

  const demos = new Demos();
  await demos.connect(RPC_URL);

  const connectOpts: { algorithm?: SigningAlgorithm; dual_sign?: boolean } = {};
  if (algorithm !== "ed25519") {
    connectOpts.algorithm = algorithm;
    connectOpts.dual_sign = dualSign;
    info(`Wallet using ${algorithm} signing${dualSign ? " (dual-sign with ed25519)" : ""}`, agentName ?? logAgentName);
  }

  const address = Object.keys(connectOpts).length > 0
    ? await demos.connectWallet(mnemonic, connectOpts)
    : await demos.connectWallet(mnemonic);

  return { demos, address };
}

// ── API Helpers ────────────────────────────────────

/**
 * Make an API call to SuperColony.
 * Handles JSON parsing, error wrapping, and auth header injection.
 *
 * IMPORTANT: This is the ONLY way to call SuperColony APIs.
 * curl/WebFetch CANNOT reach supercolony.ai (TLS handshake fails from VPN IP).
 * Node.js fetch() works fine — always use this function or the SDK.
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
    } catch (err: unknown) {
      // Network-level errors are NOT retried — only 502 responses
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 0, data: message };
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

/**
 * Log warning to stderr.
 */
export function warn(msg: string, agentName: string = logAgentName): void {
  console.error(`[${agentName}] WARN: ${msg}`);
}
