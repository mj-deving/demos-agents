/**
 * Chain-native identity lookups via Demos RPC.
 *
 * Wraps the GCR (Global Consensus Registry) identity methods that the SDK
 * Identities class provides, but via direct JSON-RPC calls instead of the
 * abstraction subpath (which crashes due to NAPI SIGSEGV).
 *
 * Each function:
 * 1. Sends a JSON-RPC call to the Demos node
 * 2. Returns typed Account[] results
 * 3. Returns empty array on any failure (graceful degradation)
 *
 * The RPC methods map 1:1 to SDK Identities class methods:
 * - getDemosIdsByTwitter(username) -> Account[]
 * - getDemosIdsByGithub(username) -> Account[]
 * - getDemosIdsByDiscord(username) -> Account[]
 * - getDemosIdsByTelegram(username) -> Account[]
 * - getDemosIdsByWeb2Identity(context, username) -> Account[]
 * - getDemosIdsByWeb3Identity(chain, address) -> Account[]
 * - getIdentities(address) -> StoredIdentities
 */

// ── Types ───────────────────────────────────────────

/** Minimal Account shape matching SDK Account interface */
export interface ChainAccount {
  pubkey: string;
  balance: string;
  nonce: number;
  identities: unknown;
  points: unknown;
  referralInfo: unknown;
  assignedTxs: string[];
  flagged: boolean;
  flaggedReason: string;
  reviewed: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── RPC Helper ──────────────────────────────────────

async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<{ result?: unknown; error?: { message?: string } }> {
  const response = await globalThis.fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: 1,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  return response.json() as Promise<{
    result?: unknown;
    error?: { message?: string };
  }>;
}

async function identityLookup(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<ChainAccount[]> {
  try {
    const json = await rpcCall(rpcUrl, method, params);
    if (json.error || !json.result) return [];
    if (!Array.isArray(json.result)) return [];
    return json.result as ChainAccount[];
  } catch {
    return [];
  }
}

// ── Platform-Specific Lookups ───────────────────────

/**
 * Look up Demos accounts linked to a Twitter/X username.
 * Uses GCR getDemosIdsByTwitter RPC method.
 */
export async function lookupByTwitter(
  rpcUrl: string,
  username: string,
): Promise<ChainAccount[]> {
  return identityLookup(rpcUrl, "getDemosIdsByTwitter", [username]);
}

/**
 * Look up Demos accounts linked to a GitHub username.
 * Uses GCR getDemosIdsByGithub RPC method.
 */
export async function lookupByGithub(
  rpcUrl: string,
  username: string,
): Promise<ChainAccount[]> {
  return identityLookup(rpcUrl, "getDemosIdsByGithub", [username]);
}

/**
 * Look up Demos accounts linked to a Discord username.
 * Uses GCR getDemosIdsByDiscord RPC method.
 */
export async function lookupByDiscord(
  rpcUrl: string,
  username: string,
): Promise<ChainAccount[]> {
  return identityLookup(rpcUrl, "getDemosIdsByDiscord", [username]);
}

/**
 * Look up Demos accounts linked to a Telegram username.
 * Uses GCR getDemosIdsByTelegram RPC method.
 */
export async function lookupByTelegram(
  rpcUrl: string,
  username: string,
): Promise<ChainAccount[]> {
  return identityLookup(rpcUrl, "getDemosIdsByTelegram", [username]);
}

/**
 * Look up Demos accounts by a generic Web2 identity (platform + username).
 * Uses GCR getDemosIdsByWeb2Identity RPC method.
 * Platform must be one of: "twitter", "github", "discord", "telegram"
 */
export async function lookupByWeb2(
  rpcUrl: string,
  platform: string,
  username: string,
): Promise<ChainAccount[]> {
  return identityLookup(rpcUrl, "getDemosIdsByWeb2Identity", [
    platform,
    username,
  ]);
}

/**
 * Look up Demos accounts by a Web3 chain address.
 * Uses GCR getDemosIdsByWeb3Identity RPC method.
 * Chain format: "eth.mainnet", "solana.mainnet", etc.
 */
export async function lookupByWeb3(
  rpcUrl: string,
  chain: string,
  address: string,
): Promise<ChainAccount[]> {
  return identityLookup(rpcUrl, "getDemosIdsByWeb3Identity", [chain, address]);
}

/**
 * Get all linked identities (web2 + cross-chain) for a Demos address.
 * Uses GCR getIdentities RPC method.
 * Returns null on any failure.
 */
export async function getIdentitiesForAddress(
  rpcUrl: string,
  address: string,
): Promise<unknown | null> {
  try {
    const json = await rpcCall(rpcUrl, "getIdentities", [address]);
    if (json.error || json.result === undefined) return null;
    return json.result;
  } catch {
    return null;
  }
}
