/**
 * connect/disconnect — session lifecycle management.
 *
 * connect() loads wallet, verifies permissions, authenticates,
 * and returns a DemosSession handle.
 *
 * Uses lazy SDK imports to avoid module-level side effects.
 */

import { open, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

import type { Demos } from "@kynesyslabs/demosdk/websdk";
import type { ConnectOptions } from "../types.js";
import { demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { FileStateStore } from "../state-store.js";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "../sdk-bridge.js";
import { validateInput, ConnectOptionsSchema } from "../schemas.js";
import { validateUrl } from "../url-validator.js";

const DEFAULT_RPC_URL = "https://demosnode.discus.sh";
const DEFAULT_ALGORITHM = "falcon";
const DEFAULT_SUPERCOLONY_API = "https://www.supercolony.ai";

/**
 * Connect to the Demos network and create a session handle.
 *
 * Flow: verify wallet file → parse credentials → connect SDK → authenticate → return session.
 *
 * @throws {DemosError} On auth failure, bad permissions, symlink, invalid wallet.
 * Unlike other toolkit tools which return ToolResult, connect/disconnect use
 * throw/void semantics because they manage session lifecycle, not tool operations.
 */
export async function connect(opts: ConnectOptions): Promise<DemosSession> {
  // Zod schema validation — shape/type only (FS/HTTPS checks remain below)
  const inputError = validateInput(ConnectOptionsSchema, opts);
  if (inputError) throw inputError;

  // HTTPS enforcement on rpcUrl
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;
  if (!opts.allowInsecureUrls && !rpcUrl.startsWith("https://")) {
    throw demosError(
      "INVALID_INPUT",
      "RPC URL must use HTTPS (set allowInsecureUrls for local dev)",
      false,
    );
  }

  // SSRF validation on apiBaseUrl — only for user-provided URLs (default is trusted)
  const apiBaseUrl = opts.supercolonyApi ?? DEFAULT_SUPERCOLONY_API;
  if (opts.supercolonyApi) {
    const apiUrlCheck = await validateUrl(apiBaseUrl, { allowInsecure: opts.allowInsecureUrls });
    if (!apiUrlCheck.valid) {
      throw demosError("INVALID_INPUT", `SuperColony API URL blocked: ${apiUrlCheck.reason}`, false);
    }
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
      // SECURITY NOTE: Container/WSL2 environments often mount host filesystems via drvfs
      // where chmod is cosmetic (permissions are always 0o777 regardless of what's set).
      // We downgrade the mode-600 check to a warning in these environments because:
      // 1. Refusing to connect would break ALL container/WSL2 usage
      // 2. The real security boundary in containers is the container itself, not file perms
      // 3. WSL2 users typically rely on Windows ACLs, not POSIX permissions
      // Risk: An attacker with access to the same container can read the wallet file.
      // Mitigation: Use Docker secrets or mount with proper permissions when possible.
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

    // Connect SDK and authenticate
    const { demos, address, authToken } = await connectAndAuthenticate(
      wallet,
      rpcUrl,
      opts.algorithm ?? DEFAULT_ALGORITHM,
    );

    const stateStore = opts.stateStore ?? new FileStateStore();

    // Create SDK bridge (session-scoped, no module-level state)
    const bridge = createSdkBridge(demos, apiBaseUrl, authToken);

    return new DemosSession({
      walletAddress: address,
      rpcUrl,
      algorithm: opts.algorithm ?? DEFAULT_ALGORITHM,
      authToken,
      signingHandle: { demos, bridge }, // Store both Demos instance and bridge
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
  address?: string;
  mnemonic?: string;
  signingHandle: unknown;
}

function parseWallet(content: string): WalletData {
  try {
    const parsed = JSON.parse(content);
    if (!parsed.address && !parsed.DEMOS_MNEMONIC) {
      throw new Error("Missing address field");
    }
    return {
      address: parsed.address,
      mnemonic: parsed.DEMOS_MNEMONIC ?? parsed.mnemonic,
      signingHandle: parsed,
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

    // Try key=value format (DEMOS_MNEMONIC=word1 word2 ...)
    const mnemonicMatch = content.match(/^DEMOS_MNEMONIC=["']?(.+?)["']?\s*$/m);
    if (mnemonicMatch) {
      const mnemonic = mnemonicMatch[1].trim();
      const wordCount = mnemonic.split(/\s+/).length;
      if (wordCount < 12 || wordCount > 24) {
        throw demosError(
          "INVALID_INPUT",
          `DEMOS_MNEMONIC has ${wordCount} words (expected 12-24)`,
          false,
        );
      }
      return {
        mnemonic,
        signingHandle: content,
      };
    }

    throw demosError(
      "INVALID_INPUT",
      `Cannot parse wallet file: ${(e as Error).message}`,
      false,
    );
  }
}

/**
 * Connect to SDK and authenticate. Uses lazy import to avoid
 * module-level side effects from sdk.ts.
 */
async function connectAndAuthenticate(
  wallet: WalletData,
  rpcUrl: string,
  algorithm: string,
): Promise<{ demos: Demos; address: string; authToken: string }> {
  try {
    // Lazy import — avoids module-level crypto polyfill and global state mutation
    const { Demos } = await import("@kynesyslabs/demosdk/websdk");

    const demos = new Demos();
    await demos.connect(rpcUrl);

    // Determine mnemonic source
    let mnemonic: string | undefined = wallet.mnemonic;
    if (!mnemonic && wallet.address) {
      // JSON wallet with address but no mnemonic — we have the address but
      // can't sign. For now, create a session with the address for read-only ops.
      // Full signing requires mnemonic.
      const authToken = await authenticateFallback(wallet.address);
      return { demos, address: wallet.address, authToken };
    }

    if (!mnemonic) {
      throw new Error("No mnemonic found in wallet file");
    }

    // Connect wallet with algorithm selection
    const address = algorithm !== "ed25519"
      ? await demos.connectWallet(mnemonic, { algorithm })
      : await demos.connectWallet(mnemonic);

    // Authenticate with SuperColony API
    let authToken: string;
    try {
      const { ensureAuth } = await import("../../lib/auth.js");
      authToken = await ensureAuth(demos, address);
    } catch (authErr) {
      // Auth may fail if SuperColony API is down — return pending token
      console.warn("[demos-toolkit] Auth failed, using pending token:", (authErr as Error).name);
      authToken = AUTH_PENDING_TOKEN;
    }

    return { demos, address, authToken };
  } catch (e) {
    // All SDK errors surface as AUTH_FAILED — granular codes deferred until SDK exposes typed errors
    throw demosError(
      "AUTH_FAILED",
      `SDK connection failed: ${(e as Error).message}`,
      true,
    );
  }
}

/**
 * Fallback auth for address-only wallets (no mnemonic = read-only).
 */
async function authenticateFallback(address: string): Promise<string> {
  try {
    const { loadAuthCache } = await import("../../lib/auth.js");
    const cached = loadAuthCache(address);
    if (cached) return cached.token;
  } catch { /* auth module may not be available */ }
  return AUTH_PENDING_TOKEN;
}

// Process-invariant: container status cannot change during process lifetime. Cached for performance.
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
