/**
 * SDK Bridge — session-scoped adapter wrapping Demos SDK instance.
 *
 * Isolates toolkit tools from module-level SDK state. Each session gets
 * its own bridge with its own auth token and API base URL.
 *
 * Does NOT import publish-pipeline.ts (avoids TLSN/Playwright transitive deps).
 * Instead, reimplements DAHR attestation using the same SDK primitives.
 */

import type { Demos } from "@kynesyslabs/demosdk/websdk";
import {
  getHivePosts as readHivePosts,
  getHivePostsByAuthor as readHivePostsByAuthor,
  getHiveReactions as readHiveReactions,
  getHiveReactionsByAuthor as readHiveReactionsByAuthor,
  getRepliesTo as readRepliesTo,
  resolvePostAuthor as readPostAuthor,
  verifyTransaction as readTransaction,
} from "./chain-reader.js";
import { safeParse } from "./guards/state-helpers.js";
import { encodeHivePayload } from "./hive-codec.js";

/** Sentinel token indicating auth has not completed — never sent as Bearer */
export const AUTH_PENDING_TOKEN = "__AUTH_PENDING__";

/** API access state — 3 distinct states, not boolean (Codex review finding) */
export type ApiAccessState = "none" | "configured" | "authenticated";

/**
 * Normalized chain transaction — bridges the gap between SDK's
 * Transaction (parsed content) and RawTransaction (stringified content).
 */
export interface ChainTransaction {
  hash: string;
  from: string;
  to: string;
  type: string;
  data: unknown;
  status: string;
  blockNumber: number;
  timestamp: number;
}

/** Strip query params from URLs to prevent API key leakage in error messages */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return "[invalid URL]";
  }
}

/** Transaction module interface — typed replacement for bare Function fields */
export interface TxModule {
  store(data: Uint8Array, demos: Demos): Promise<unknown>;
  confirm(storeTx: unknown, demos: Demos): Promise<unknown>;
  broadcast(validity: unknown, demos: Demos): Promise<unknown>;
}

/** Error keywords indicating auth/rate-limit failures in DAHR proxy responses */
const DAHR_ERROR_KEYWORDS = ["unauthorized", "forbidden", "rate limit", "api key", "access denied"] as const;

/** Minimal typed surface for Demos SDK methods used by the bridge */
interface DemosRpcMethods {
  web2: { createDahr(): Promise<{ startProxy(opts: { url: string; method: string }): Promise<Record<string, unknown>> }> };
  /** Creates a signed native transfer transaction (does NOT broadcast — must call confirm+broadcast) */
  transfer(to: string, amount: number): Promise<{ hash?: string; content?: Record<string, unknown>; [key: string]: unknown }>;
  /** Confirms a signed transaction (validates gas/membership) */
  confirm(transaction: unknown): Promise<unknown>;
  /** Broadcasts a confirmed transaction to the network */
  broadcast(validityData: unknown): Promise<unknown>;
  sendTransaction(txData: unknown): Promise<{ hash?: string; txHash?: string }>;
  // NOTE: queryTx/getTx removed — these methods don't exist on the Demos SDK class.
  // Use getTxByHash instead (chain-first migration).
  connect(rpcUrl: string): Promise<void>;
  connectWallet(mnemonic: string, opts?: Record<string, unknown>): Promise<string>;
  // Chain query methods (chain-first migration)
  getTxByHash?(txHash: string): Promise<{
    hash: string;
    blockNumber: number;
    status: string;
    content: { from: string; to: string; type: string; data: unknown; timestamp: number };
  }>;
  getTransactions?(start?: number | "latest", limit?: number): Promise<Array<{
    hash: string;
    blockNumber: number;
    status: string;
    from: string;
    to: string;
    type: string;
    content: string;
    timestamp: number;
  }>>;
  getMempool?(): Promise<Array<{
    hash: string;
    blockNumber: number;
    status: string;
    content: { from: string; to: string; type: string; data: unknown; timestamp: number };
  }>>;
  /** Per-address, type-filtered transaction history — server-side filtering */
  getTransactionHistory?(address: string, type?: string, options?: { start?: number; limit?: number }): Promise<Array<{
    hash: string;
    blockNumber: number;
    status: string;
    content: { from: string; to: string; type: string; data: unknown; timestamp: number };
  }>>;
}

/** Typed D402 client surface — mirrors SDK's D402Client API */
interface D402ClientLike {
  createPayment(req: D402PaymentRequirement): Promise<{ hash?: string; content?: Record<string, unknown> }>;
  settle(payment: { hash?: string; content?: Record<string, unknown> }): Promise<D402SettlementResult>;
}

// ── Types ───────────────────────────────────────────

export interface DahrResult {
  responseHash: string;
  txHash: string;
  data: unknown;
  url: string;
}

export interface ApiCallResult {
  ok: boolean;
  status: number;
  data: unknown;
  /** Error type name when ok=false and status=0 (network/transport error) */
  errorType?: string;
}

/** HIVE post payload for on-chain publishing */
export interface HivePost {
  text: string;
  category: string;
  tags?: string[];
  confidence?: number;
  replyTo?: string;
  assets?: string[];
  sourceAttestations?: Array<{
    url: string;
    responseHash: string;
    txHash: string;
    timestamp?: number;
  }>;
}

/** D402 payment requirement from 402 response */
export interface D402PaymentRequirement {
  amount: number;
  recipient: string;
  resourceId: string;
  description?: string;
}

/** D402 settlement result */
export interface D402SettlementResult {
  success: boolean;
  hash: string;
  blockNumber?: number;
  message?: string;
}

export interface SdkBridge {
  /** Create a DAHR attestation for a URL */
  attestDahr(url: string, method?: string): Promise<DahrResult>;

  /** Make an authenticated API call to SuperColony */
  apiCall(path: string, options?: RequestInit): Promise<ApiCallResult>;

  /** Publish a HIVE-encoded post to the Demos chain */
  publishHivePost(post: HivePost): Promise<{ txHash: string }>;

  /** Transfer DEM tokens to a recipient */
  transferDem(to: string, amount: number, memo: string): Promise<{ txHash: string }>;

  /** Settle a D402 payment (createPayment + settle, nonce-safe) */
  payD402(requirement: D402PaymentRequirement): Promise<D402SettlementResult>;

  // queryTransaction removed — superseded by resolvePostAuthor (chain-first)

  // ── Chain-first methods ────────────────────────────

  /** API access state — none (no API URL), configured (URL set, auth pending), authenticated (full access) */
  apiAccess: ApiAccessState;

  /** Verify a transaction by hash — returns confirmation status + block info, or null if not found */
  verifyTransaction(txHash: string): Promise<{ confirmed: boolean; blockNumber?: number; from?: string } | null>;

  /** Get recent HIVE posts from chain via getTransactions — paginated, decoded */
  getHivePosts(limit: number): Promise<import("./types.js").ScanPost[]>;

  /** Resolve post author address from chain transaction */
  resolvePostAuthor(txHash: string): Promise<string | null>;

  /** Count HIVE reactions for given post txHashes — single chain scan, returns map of txHash → { agree, disagree } */
  getHiveReactions(targetTxHashes: string[]): Promise<Map<string, { agree: number; disagree: number }>>;

  /** Get HIVE posts by a specific author — uses getTransactionHistory for server-side type filtering */
  getHivePostsByAuthor(address: string, options?: { limit?: number }): Promise<import("./types.js").ScanPost[]>;

  /** Get HIVE reactions cast by a specific author — uses getTransactionHistory for server-side type filtering */
  getHiveReactionsByAuthor(address: string, options?: { limit?: number }): Promise<import("./types.js").HiveReaction[]>;

  /** Get replies to specific posts — global chain scan filtered by replyTo field */
  getRepliesTo(txHashes: string[]): Promise<import("./types.js").ScanPost[]>;

  /** Publish a HIVE reaction on-chain (agree/disagree as storage transaction) */
  publishHiveReaction(targetTxHash: string, reactionType: "agree" | "disagree"): Promise<{ txHash: string }>;

  /**
   * Get the underlying Demos instance (for direct SDK access when needed).
   * @throws {Error} Unless bridge was created with `options.allowRawSdk: true`.
   */
  getDemos(): Demos;
}

// ── Helpers ──────────────────────────────────────────

/**
 * Extract txHash from SDK store/confirm/broadcast response shapes.
 * The SDK returns different shapes depending on version and method:
 *   - confirm: { response: { data: { transaction: { hash } } } }
 *   - broadcast: { response: { results: { [key]: { hash } } } }
 *   - broadcast: { response: { data: { hash } } }
 *   - fallback: { hash } or { txHash }
 */
export function extractTxHash(confirmResult: unknown, broadcastResult?: unknown): string | undefined {
  const extract = (obj: unknown): string | undefined => {
    if (!obj || typeof obj !== "object") return undefined;
    const r = obj as Record<string, unknown>;
    const resp = r.response as Record<string, unknown> | undefined;
    if (resp) {
      const txn = (resp.data as Record<string, unknown> | undefined)?.transaction as Record<string, unknown> | undefined;
      if (txn?.hash) return String(txn.hash);
      if ((resp.data as Record<string, unknown> | undefined)?.hash) return String((resp.data as Record<string, unknown>).hash);
      const results = resp.results as Record<string, unknown> | undefined;
      if (results) {
        const first = Object.values(results)[0] as Record<string, unknown> | undefined;
        if (first?.hash) return String(first.hash);
      }
    }
    if (r.hash) return String(r.hash);
    if (r.txHash) return String(r.txHash);
    return undefined;
  };
  return extract(confirmResult) ?? extract(broadcastResult);
}

// ── Factory ─────────────────────────────────────────

/**
 * Create a session-scoped SDK bridge.
 *
 * @param demos - Connected Demos instance (wallet already loaded)
 * @param apiBaseUrl - SuperColony API base URL (optional — omit for chain-only mode)
 * @param authToken - Authentication token for API calls
 * @param fetchImpl - Optional fetch implementation (for testing)
 * @param txModule - Optional DemosTransactions override (for testing)
 */

export function createSdkBridge(
  demos: Demos,
  apiBaseUrl: string | undefined,
  authToken: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  txModule?: TxModule,
  options?: { allowRawSdk?: boolean },
): SdkBridge {
  // Single cast at factory level — all methods below use typed `rpc`
  const rpc = demos as unknown as DemosRpcMethods;

  // Closure-scoped lazy loaders — avoids module-level shared mutable state
  let cachedTxModule: TxModule | null = txModule ?? null;
  let cachedD402Client: D402ClientLike | null = null;
  async function loadTxModule(): Promise<TxModule> {
    if (cachedTxModule) return cachedTxModule;
    const { DemosTransactions } = await import("@kynesyslabs/demosdk/websdk");
    cachedTxModule = DemosTransactions as TxModule;
    return cachedTxModule;
  }

  return {
    /**
     * Create a DAHR attestation for a URL.
     *
     * TRUST BOUNDARY: DAHR proxy fetches the URL server-side, bypassing this client's
     * SSRF validator. The proxy is operated by KyneSys and has its own URL restrictions.
     * Client-side SSRF checks (validateUrl) protect against client-originated requests
     * but cannot prevent the DAHR proxy from being used as an SSRF amplifier.
     * Mitigation: URL allowlist enforcement in attest.ts + publish.ts restricts which
     * URLs reach the proxy.
     */
    async attestDahr(url: string, method: string = "GET"): Promise<DahrResult> {
      const dahr = await rpc.web2.createDahr();
      const safeUrl = sanitizeUrl(url);

      // startProxy can hang indefinitely (observed 300s+ in TLSN era) — bound to 30s
      const DAHR_PROXY_TIMEOUT_MS = 30_000;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const proxyResponse: Record<string, unknown> = await Promise.race([
        dahr.startProxy({ url, method }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`DAHR proxy timeout (${DAHR_PROXY_TIMEOUT_MS / 1000}s)`)), DAHR_PROXY_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timeoutId));

      // HTTP status guard (same logic as publish-pipeline.ts:attestDahr)
      const httpStatus = proxyResponse.status ?? proxyResponse.statusCode ?? proxyResponse.httpStatus;
      if (typeof httpStatus === "number" && (httpStatus < 200 || httpStatus >= 300)) {
        throw new Error(`DAHR source returned HTTP ${httpStatus} — refusing to attest. URL: ${safeUrl}`);
      }

      // Parse response data
      let data: unknown;
      if (typeof proxyResponse.data === "string") {
        const trimmed = proxyResponse.data.trim();
        if (trimmed.startsWith("<")) {
          throw new Error(`DAHR returned XML/HTML instead of JSON. URL: ${safeUrl}`);
        }
        try {
          data = safeParse(proxyResponse.data);
        } catch {
          throw new Error(`DAHR returned non-JSON response. URL: ${safeUrl}`);
        }
      } else {
        data = proxyResponse.data;
      }

      // Error payload guard
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>;
        const errField = obj.error ?? obj.Error ?? obj.message ?? obj.detail;
        if (typeof errField === "string") {
          const errLower = errField.toLowerCase();
          if (DAHR_ERROR_KEYWORDS.some(kw => errLower.includes(kw))) {
            throw new Error(`DAHR source returned error: "${errField}". URL: ${safeUrl}`);
          }
        }
      }

      return {
        responseHash: String(proxyResponse.responseHash ?? ""),
        txHash: String(proxyResponse.txHash ?? ""),
        data,
        url,
      };
    },

    async apiCall(path: string, options: RequestInit = {}): Promise<ApiCallResult> {
      // Restrict to relative SuperColony API paths — absolute URLs are not allowed
      // to prevent SSRF and token leakage via attacker-controlled URLs
      if (path.startsWith("http://") || path.startsWith("https://")) {
        return { ok: false, status: 0, data: "apiCall only accepts relative paths (e.g., '/api/feed')" };
      }

      // Chain-only mode — no API configured
      if (!apiBaseUrl) {
        return { ok: false, status: 0, data: "API not configured — chain-only mode" };
      }

      const url = `${apiBaseUrl}${path}`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string> || {}),
      };

      // Always attach auth token — all paths are relative to SuperColony API
      if (authToken !== AUTH_PENDING_TOKEN) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      try {
        const res = await fetchImpl(url, { ...options, headers });
        const text = await res.text();
        let data: unknown;
        try {
          data = safeParse(text);
        } catch {
          data = text;
        }
        return { ok: res.ok, status: res.status, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorName = err instanceof Error ? err.constructor.name : "Error";
        console.warn(`[demos-toolkit] apiCall failed: ${message}`);
        return { ok: false, status: 0, data: message, errorType: errorName };
      }
    },

    async publishHivePost(post: HivePost): Promise<{ txHash: string }> {
      // Lazy-import DemosTransactions or use injected mock
      const tx = txModule ?? await loadTxModule();

      // Construct HIVE post object
      const hivePost: Record<string, unknown> = {
        v: 1,
        cat: post.category,
        text: post.text,
      };
      if (post.tags && post.tags.length > 0) hivePost.tags = post.tags;
      if (post.confidence !== undefined) hivePost.confidence = post.confidence;
      if (post.replyTo) hivePost.replyTo = post.replyTo;
      if (post.assets && post.assets.length > 0) hivePost.assets = post.assets;
      if (post.sourceAttestations && post.sourceAttestations.length > 0) {
        hivePost.sourceAttestations = post.sourceAttestations.map((a) => ({
          url: a.url,
          responseHash: a.responseHash,
          txHash: a.txHash,
          timestamp: a.timestamp ?? Date.now(),
        }));
      }

      const encoded = encodeHivePayload(hivePost);

      // Store data on-chain, confirm membership proof, broadcast to network
      const storeTx = await tx.store(encoded, demos);
      const validity = await tx.confirm(storeTx, demos);
      const result = await tx.broadcast(validity, demos);

      // Extract txHash — confirm response is the primary source (SDK convention),
      // broadcast response is the fallback for alternate SDK versions.
      const txHash = extractTxHash(validity, result);

      if (!txHash) {
        throw new Error("HIVE post broadcast succeeded but txHash not found in response");
      }

      return { txHash: String(txHash) };
    },

    async transferDem(to: string, amount: number, memo: string): Promise<{ txHash: string }> {
      if (!to || typeof to !== "string") {
        throw new Error("transferDem: 'to' address is required");
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`transferDem: invalid amount ${amount} — must be a positive finite number`);
      }
      // SDK transfer() creates signed tx only (2 params — memo not supported at SDK level).
      // Must confirm + broadcast to actually submit to the network.
      const signedTx = await rpc.transfer(to, amount);
      const validity = await rpc.confirm(signedTx);
      const broadcastResult = await rpc.broadcast(validity);
      const txHash = extractTxHash(validity, broadcastResult);
      if (!txHash) {
        throw new Error("DEM transfer broadcast succeeded but txHash not found in response");
      }
      return { txHash: String(txHash) };
    },

    async payD402(requirement: D402PaymentRequirement): Promise<D402SettlementResult> {
      try {
        if (!cachedD402Client) {
          const { D402Client } = await import("@kynesyslabs/demosdk/d402/client");
          cachedD402Client = new D402Client(demos) as D402ClientLike;
        }
        const client = cachedD402Client;
        const payment = await client.createPayment(requirement);
        return await client.settle(payment);
      } catch (e) {
        if (e && typeof e === "object" && "success" in e && (e as D402SettlementResult).success === false) throw e;
        throw new Error(`D402 settlement failed: ${(e as Error).message}`);
      }
    },

    // ── Chain-first methods ──────────────────────────

    get apiAccess(): ApiAccessState {
      if (!apiBaseUrl) return "none";
      if (authToken === AUTH_PENDING_TOKEN) return "configured";
      return "authenticated";
    },

    async verifyTransaction(txHash: string): Promise<{ confirmed: boolean; blockNumber?: number; from?: string } | null> {
      return readTransaction(rpc, txHash);
    },

    async getHivePosts(limit: number): Promise<import("./types.js").ScanPost[]> {
      return readHivePosts(rpc, limit);
    },

    async getHiveReactions(targetTxHashes: string[]): Promise<Map<string, { agree: number; disagree: number }>> {
      return readHiveReactions(rpc, targetTxHashes);
    },

    async resolvePostAuthor(txHash: string): Promise<string | null> {
      return readPostAuthor(rpc, txHash);
    },

    async getHivePostsByAuthor(address: string, options?: { limit?: number }): Promise<import("./types.js").ScanPost[]> {
      return readHivePostsByAuthor(rpc, address, options);
    },

    async getHiveReactionsByAuthor(address: string, options?: { limit?: number }): Promise<import("./types.js").HiveReaction[]> {
      return readHiveReactionsByAuthor(rpc, address, options);
    },

    async getRepliesTo(txHashes: string[]): Promise<import("./types.js").ScanPost[]> {
      return readRepliesTo(rpc, txHashes);
    },

    async publishHiveReaction(targetTxHash: string, reactionType: "agree" | "disagree"): Promise<{ txHash: string }> {
      if (!targetTxHash || typeof targetTxHash !== "string" || targetTxHash.length < 8) {
        throw new Error("publishHiveReaction: invalid targetTxHash");
      }
      const tx = txModule ?? await loadTxModule();
      const encoded = encodeHivePayload({ v: 1, action: "react", target: targetTxHash, type: reactionType });

      const storeTx = await tx.store(encoded, demos);
      const validity = await tx.confirm(storeTx, demos);
      const result = await tx.broadcast(validity, demos);
      const txHash = extractTxHash(validity, result);
      if (!txHash) {
        throw new Error("HIVE reaction broadcast succeeded but txHash not found in response");
      }
      return { txHash: String(txHash) };
    },

    getDemos(): Demos {
      if (!options?.allowRawSdk) {
        throw new Error(
          "getDemos() exposes raw SDK bypassing all guardrails. Set allowRawSdk: true to opt in.",
        );
      }
      return demos;
    },
  };
}
