/**
 * connect/disconnect — session lifecycle management.
 *
 * connect() loads wallet, verifies permissions, authenticates,
 * and returns a DemosSession handle.
 *
 * disconnect() expires the session and clears sensitive data.
 */

import { open, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

import type { ConnectOptions } from "../types.js";
import { demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { FileStateStore } from "../state-store.js";

const DEFAULT_RPC_URL = "https://demosnode.discus.sh";
const DEFAULT_ALGORITHM = "falcon";

/**
 * Connect to the Demos network and create a session handle.
 *
 * Verifies wallet file permissions (mode 600), loads credentials,
 * authenticates with SuperColony API, and returns an opaque DemosSession.
 */
export async function connect(opts: ConnectOptions): Promise<DemosSession> {
  // HTTPS enforcement on rpcUrl
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;
  if (!opts.allowInsecureUrls && !rpcUrl.startsWith("https://")) {
    throw demosError(
      "INVALID_INPUT",
      "RPC URL must use HTTPS (set allowInsecureUrls for local dev)",
      false,
    );
  }

  const walletPath = resolve(opts.walletPath.replace(/^~(?=$|\/)/, homedir()));

  // Symlink check — prevents mode-600 bypass via symlink
  const lstats = await lstat(walletPath);
  if (lstats.isSymbolicLink()) {
    throw demosError(
      "INVALID_INPUT",
      "Wallet path is a symlink — refusing to read (symlink mode 600 does not guarantee target is restricted)",
      false,
    );
  }

  // Open file then fstat — prevents TOCTOU between check and read
  const fd = await open(walletPath, "r");
  try {
    const fstats = await fd.stat();
    const mode = fstats.mode & 0o777;

    if (mode !== 0o600) {
      // Check for container/WSL2 where chmod is cosmetic
      const isContainer = await detectContainer();
      if (isContainer) {
        console.warn(
          `[demos-toolkit] Warning: Wallet file permissions are ${mode.toString(8)} ` +
          `(expected 600). Running in container/WSL2 where chmod may be cosmetic.`,
        );
      } else {
        throw demosError(
          "INVALID_INPUT",
          `Wallet file permissions are ${mode.toString(8)} — must be 600. Run: chmod 600 ${walletPath}`,
          false,
        );
      }
    }

    // Read wallet credentials
    const walletContent = await fd.readFile({ encoding: "utf-8" });
    const wallet = parseWallet(walletContent);

    // Authenticate (placeholder — actual auth uses SDK)
    const authToken = await authenticate(wallet.address, opts.rpcUrl ?? DEFAULT_RPC_URL);

    const stateStore = opts.stateStore ?? new FileStateStore();

    return new DemosSession({
      walletAddress: wallet.address,
      rpcUrl: opts.rpcUrl ?? DEFAULT_RPC_URL,
      algorithm: opts.algorithm ?? DEFAULT_ALGORITHM,
      authToken,
      signingHandle: wallet.signingHandle,
      skillDojoFallback: opts.skillDojoFallback,
      preferredPath: opts.preferredPath,
      stateStore,
      onToolCall: opts.onToolCall,
      tipPolicy: opts.tipPolicy,
      payPolicy: opts.payPolicy,
      urlAllowlist: opts.urlAllowlist,
      allowInsecureUrls: opts.allowInsecureUrls,
      sourceCatalogPath: opts.sourceCatalogPath,
      specsDir: opts.specsDir,
      entityMaps: opts.entityMaps,
    });
  } finally {
    await fd.close();
  }
}

/** Disconnect — expire session and clear sensitive data */
export function disconnect(session: DemosSession): void {
  session.expire();
}

// ── Internal helpers ────────────────────────────────

interface WalletData {
  address: string;
  signingHandle: unknown;
}

function parseWallet(content: string): WalletData {
  try {
    const parsed = JSON.parse(content);
    if (!parsed.address) {
      throw new Error("Missing address field");
    }
    return {
      address: parsed.address,
      signingHandle: parsed, // Full wallet object as signing handle
    };
  } catch (e) {
    // Detect mnemonic format but reject — address derivation requires SDK bridge
    const lines = content.trim().split("\n");
    if (lines.length === 1 && lines[0].split(" ").length >= 12) {
      throw demosError(
        "INVALID_INPUT",
        "Mnemonic wallet files are not yet supported — SDK bridge needed to derive address. Use a JSON wallet file with an 'address' field.",
        false,
      );
    }
    throw demosError(
      "INVALID_INPUT",
      `Cannot parse wallet file: ${(e as Error).message}`,
      false,
    );
  }
}

async function authenticate(_address: string, _rpcUrl: string): Promise<string> {
  // Placeholder — actual implementation uses existing auth.ts flow
  // In the full integration, this calls:
  // 1. connectWallet() from connectors/
  // 2. SuperColony API challenge-response auth
  // 3. Returns short-lived auth token
  return "pending-auth-integration";
}

// Cached — container status is invariant per process
let _isContainer: boolean | null = null;

async function detectContainer(): Promise<boolean> {
  if (_isContainer !== null) return _isContainer;

  const { readFile: readFileAsync } = await import("node:fs/promises");
  let result = false;

  try {
    await readFileAsync("/.dockerenv");
    result = true;
  } catch { /* not in docker */ }

  if (!result) {
    try {
      const cgroup = await readFileAsync("/proc/1/cgroup", "utf-8");
      if (cgroup.includes("docker") || cgroup.includes("containerd")) result = true;
    } catch { /* /proc may not exist */ }
  }

  if (!result) {
    try {
      const mounts = await readFileAsync("/proc/mounts", "utf-8");
      if (mounts.includes("drvfs")) result = true;
    } catch { /* /proc may not exist */ }
  }

  _isContainer = result;
  return result;
}
