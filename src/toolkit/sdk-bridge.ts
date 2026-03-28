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
import { safeParse } from "./guards/state-helpers.js";

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
function extractTxHash(confirmResult: unknown, broadcastResult: unknown): string | undefined {
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

// HIVE post prefix (4 bytes: ASCII "HIVE")
const HIVE_PREFIX = new Uint8Array([0x48, 0x49, 0x56, 0x45]);
const HIVE_PREFIX_HEX = "48495645";
const HIVE_PREFIX_STR = "HIVE";

/** Check if bytes start with the 4-byte HIVE prefix */
function hasHivePrefix(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === HIVE_PREFIX[0] && bytes[1] === HIVE_PREFIX[1] &&
    bytes[2] === HIVE_PREFIX[2] && bytes[3] === HIVE_PREFIX[3];
}

/** Encode a JSON payload with HIVE 4-byte prefix for on-chain storage */
function encodeHivePayload(payload: Record<string, unknown>): Uint8Array {
  const json = JSON.stringify(payload);
  const jsonBytes = new TextEncoder().encode(json);
  const encoded = new Uint8Array(HIVE_PREFIX.length + jsonBytes.length);
  encoded.set(HIVE_PREFIX, 0);
  encoded.set(jsonBytes, HIVE_PREFIX.length);
  return encoded;
}

/** Regex for base64 character set — skip Buffer.from on obvious non-base64 */
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

/**
 * Decode HIVE data from a chain transaction's content.data field.
 * Handles multiple encodings: Uint8Array, hex string, base64, raw string with HIVE prefix.
 * Returns parsed JSON payload or null if not a HIVE transaction.
 */
function decodeHiveData(data: unknown): Record<string, unknown> | null {
  if (!data) return null;

  let jsonStr: string | null = null;

  if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array((data as ArrayBufferView).buffer);
    if (bytes.length < 4) return null;
    if (hasHivePrefix(bytes)) {
      jsonStr = new TextDecoder().decode(bytes.slice(4));
    }
  } else if (typeof data === "string") {
    // Hex-encoded: "48495645..." — cap at 64KB to prevent OOM from malicious chain data
    if (data.toLowerCase().startsWith(HIVE_PREFIX_HEX)) {
      const hexPayload = data.slice(8);
      if (hexPayload.length > 128 * 1024) return null; // 64KB decoded limit
      const bytes = new Uint8Array(hexPayload.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? []);
      jsonStr = new TextDecoder().decode(bytes);
    }
    // Raw string with "HIVE" prefix
    else if (data.startsWith(HIVE_PREFIX_STR)) {
      jsonStr = data.slice(4);
    }
    // Base64-encoded HIVE data — only attempt if string matches base64 charset
    else if (BASE64_RE.test(data) && data.length >= 8) {
      try {
        const decoded = Buffer.from(data, "base64");
        if (hasHivePrefix(decoded)) {
          jsonStr = decoded.slice(4).toString("utf-8");
        }
      } catch {
        // Not valid base64
      }
    }
  }
  // TransactionContentData tuple: ["storage", payload] — extract payload
  else if (Array.isArray(data)) {
    if (data.length >= 2 && data[0] === "storage") {
      return decodeHiveData(data[1]); // recurse on the actual payload
    }
    return null;
  }
  // Already-parsed object (from Transaction.content.data that was pre-decoded)
  else if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    // SDK storage envelope: {"bytes":"SElWRXsi..."} — base64-encoded HIVE payload
    if (typeof obj.bytes === "string" && obj.bytes.length >= 8 && obj.bytes.length <= 172 * 1024) {
      // Size guard: base64 at 172KB → ~128KB decoded. Matches hex branch 64KB limit.
      try {
        const decoded = Buffer.from(obj.bytes, "base64");
        if (hasHivePrefix(decoded)) {
          jsonStr = decoded.slice(4).toString("utf-8");
        }
      } catch {
        // Not valid base64
      }
    }
    // Direct HIVE object (pre-decoded)
    else if (obj.v !== undefined && (obj.text !== undefined || obj.action !== undefined)) {
      return obj;
    }
    if (!jsonStr) return null;
  }

  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === "object" && parsed !== null) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a session-scoped SDK bridge.
 *
 * @param demos - Connected Demos instance (wallet already loaded)
 * @param apiBaseUrl - SuperColony API base URL (optional — omit for chain-only mode)
 * @param authToken - Authentication token for API calls
 * @param fetchImpl - Optional fetch implementation (for testing)
 * @param txModule - Optional DemosTransactions override (for testing)
 */
// ── Shared Pagination Helper ─────────────────────────

interface DecodedTx { tx: { hash: string; blockNumber: number; author: string; timestamp: number }; hive: Record<string, unknown> }

/**
 * Scan an address's storage transactions and decode HIVE payloads.
 * Uses getTransactionHistory (server-side filter) when available, falls back to getTransactions + client-side filter.
 * The `filter` predicate controls which decoded HIVE entries are included (posts vs reactions).
 */
async function scanAddressStorage(
  rpc: DemosRpcMethods,
  address: string,
  limit: number,
  filter: (decoded: Record<string, unknown>) => boolean,
): Promise<DecodedTx[]> {
  const results: DecodedTx[] = [];

  if (rpc.getTransactionHistory) {
    const PAGE_SIZE = 100;
    const MAX_PAGES = Math.ceil(limit / PAGE_SIZE);
    let start: number | undefined;

    for (let page = 0; page < MAX_PAGES && results.length < limit; page++) {
      const txs = await rpc.getTransactionHistory(address, "storage", { start, limit: PAGE_SIZE });
      if (!txs || txs.length === 0) break;

      for (const tx of txs) {
        try {
          const contentData = tx.content?.data;
          const data = Array.isArray(contentData) && contentData[0] === "storage" ? contentData[1] : contentData;
          const decoded = decodeHiveData(data);
          if (!decoded || !filter(decoded)) continue;
          results.push({
            tx: { hash: tx.hash, blockNumber: tx.blockNumber, author: tx.content?.from ? String(tx.content.from) : address, timestamp: tx.content?.timestamp ?? 0 },
            hive: decoded,
          });
        } catch { /* skip malformed */ }
      }

      const lastTx = txs[txs.length - 1];
      if (lastTx?.blockNumber != null && lastTx.blockNumber > 1) {
        const nextStart = lastTx.blockNumber - 1;
        if (nextStart === start) break;
        start = nextStart;
      } else break;
    }
  } else if (rpc.getTransactions) {
    const PAGE_SIZE = 100;
    const MAX_PAGES = 10; // Global scan — need more pages than ceil(limit/100) since most txs won't match
    let start: number | "latest" = "latest";
    const addrLower = address.toLowerCase();

    for (let page = 0; page < MAX_PAGES && results.length < limit; page++) {
      const txs = await rpc.getTransactions(start, PAGE_SIZE);
      if (!txs || txs.length === 0) break;

      for (const rawTx of txs) {
        if (rawTx.type !== "storage") continue;
        if (String(rawTx.from ?? "").toLowerCase() !== addrLower) continue;

        try {
          const content = typeof rawTx.content === "string"
            ? safeParse(rawTx.content) as Record<string, unknown>
            : rawTx.content as Record<string, unknown>;
          const rawData = content?.data;
          const data = Array.isArray(rawData) && rawData[0] === "storage" ? rawData[1] : rawData;
          const decoded = decodeHiveData(data);
          if (!decoded || !filter(decoded)) continue;
          results.push({
            tx: { hash: rawTx.hash, blockNumber: rawTx.blockNumber, author: String(rawTx.from ?? content?.from ?? address), timestamp: rawTx.timestamp ?? Number(content?.timestamp ?? 0) },
            hive: decoded,
          });
        } catch { /* skip malformed */ }
      }

      const lastTx = txs[txs.length - 1];
      const prevStart = start;
      if (lastTx?.blockNumber != null && lastTx.blockNumber > 1) {
        start = lastTx.blockNumber - 1;
      } else break;
      if (start === prevStart) break;
    }
  }

  return results;
}

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
        return { ok: false, status: 0, data: `[${errorName}] ${message}` };
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
      if (!rpc.getTxByHash) return null; // Unsupported — caller should not retry

      // Errors propagate to caller (verify.ts retry loop handles them)
      const tx = await rpc.getTxByHash(txHash);
      if (!tx) return { confirmed: false };
      const confirmed = tx.blockNumber > 0 && tx.status === "confirmed";
      return {
        confirmed,
        blockNumber: tx.blockNumber,
        from: tx.content?.from,
      };
    },

    async getHivePosts(limit: number): Promise<import("./types.js").ScanPost[]> {
      if (!rpc.getTransactions) return [];
      const MAX_PAGES = 5;
      const PAGE_SIZE = 100;
      const posts: import("./types.js").ScanPost[] = [];
      let start: number | "latest" = "latest";

      for (let page = 0; page < MAX_PAGES && posts.length < limit; page++) {
        const txs = await rpc.getTransactions(start, PAGE_SIZE);
        if (!txs || txs.length === 0) break;

        for (const rawTx of txs) {
          if (rawTx.type !== "storage") continue;
          try {
            // RawTransaction has content as string — parse it
            const content = typeof rawTx.content === "string"
              ? safeParse(rawTx.content) as Record<string, unknown>
              : rawTx.content as Record<string, unknown>;
            // TransactionContentData is a tuple ["storage", StoragePayload] — extract payload
            const rawData = content?.data;
            const data = Array.isArray(rawData) && rawData[0] === "storage" ? rawData[1] : rawData;
            const decoded = decodeHiveData(data);
            if (!decoded) continue;
            // Skip reactions and other action-typed entries — only include posts (have text, no action)
            if (decoded.action) continue;
            posts.push({
              txHash: rawTx.hash,
              text: String(decoded.text ?? ""),
              category: String(decoded.cat ?? decoded.category ?? ""),
              author: String(rawTx.from ?? content?.from ?? ""),
              timestamp: rawTx.timestamp ?? Number(content?.timestamp ?? 0),
              reactions: { agree: 0, disagree: 0 },
              reactionsKnown: false,
              tags: Array.isArray(decoded.tags) ? decoded.tags.map(String) : [],
              replyTo: decoded.replyTo ? String(decoded.replyTo) : undefined,
              blockNumber: rawTx.blockNumber,
            });
          } catch {
            // Skip malformed transactions
          }
        }

        // Advance cursor — use last tx's blockNumber for next batch
        const lastTx = txs[txs.length - 1];
        const prevStart = start;
        if (lastTx?.blockNumber != null && lastTx.blockNumber > 1) {
          start = lastTx.blockNumber - 1;
        } else {
          break; // No valid cursor — stop paginating
        }
        // Safety: if cursor didn't advance, break to prevent endless loop
        if (start === prevStart) break;
      }

      return posts.slice(0, limit);
    },

    async getHiveReactions(targetTxHashes: string[]): Promise<Map<string, { agree: number; disagree: number }>> {
      const result = new Map<string, { agree: number; disagree: number }>();
      if (!rpc.getTransactions || targetTxHashes.length === 0) return result;

      // Initialize counters for all targets
      const targets = new Set(targetTxHashes);
      for (const h of targets) result.set(h, { agree: 0, disagree: 0 });

      // Single pass through recent chain transactions
      const MAX_PAGES = 10;
      const PAGE_SIZE = 100;
      let start: number | "latest" = "latest";

      for (let page = 0; page < MAX_PAGES; page++) {
        const txs = await rpc.getTransactions(start, PAGE_SIZE);
        if (!txs || txs.length === 0) break;

        for (const rawTx of txs) {
          if (rawTx.type !== "storage") continue;
          try {
            const content = typeof rawTx.content === "string"
              ? safeParse(rawTx.content) as Record<string, unknown>
              : rawTx.content as Record<string, unknown>;
            const rawData = content?.data;
            const data = Array.isArray(rawData) && rawData[0] === "storage" ? rawData[1] : rawData;
            const decoded = decodeHiveData(data);
            if (!decoded || decoded.action !== "react") continue;

            const target = String(decoded.target ?? "");
            const type = String(decoded.type ?? "");
            if (!targets.has(target)) continue;

            const counts = result.get(target)!;
            if (type === "agree") counts.agree++;
            else if (type === "disagree") counts.disagree++;
          } catch {
            // Skip malformed transactions
          }
        }

        const lastTx = txs[txs.length - 1];
        const prevStart = start;
        if (lastTx?.blockNumber != null && lastTx.blockNumber > 1) {
          start = lastTx.blockNumber - 1;
        } else {
          break;
        }
        if (start === prevStart) break;
      }

      return result;
    },

    async resolvePostAuthor(txHash: string): Promise<string | null> {
      try {
        if (!rpc.getTxByHash) return null;
        const tx = await rpc.getTxByHash(txHash);
        if (!tx?.content?.from) return null;
        return String(tx.content.from);
      } catch {
        return null;
      }
    },

    async getHivePostsByAuthor(address: string, options?: { limit?: number }): Promise<import("./types.js").ScanPost[]> {
      const limit = options?.limit ?? 200;
      const posts: import("./types.js").ScanPost[] = [];

      const decoded = await scanAddressStorage(rpc, address, limit, (d) => !d.action && d.text !== undefined);
      for (const { tx, hive } of decoded) {
        posts.push({
          txHash: tx.hash,
          text: String(hive.text ?? ""),
          category: String(hive.cat ?? hive.category ?? ""),
          author: tx.author,
          timestamp: tx.timestamp,
          reactions: { agree: 0, disagree: 0 },
          reactionsKnown: false,
          tags: Array.isArray(hive.tags) ? hive.tags.map(String) : [],
          replyTo: hive.replyTo ? String(hive.replyTo) : undefined,
          blockNumber: tx.blockNumber,
        });
      }
      return posts;
    },

    async getHiveReactionsByAuthor(address: string, options?: { limit?: number }): Promise<import("./types.js").HiveReaction[]> {
      const limit = options?.limit ?? 200;
      const reactions: import("./types.js").HiveReaction[] = [];

      const decoded = await scanAddressStorage(rpc, address, limit, (d) => d.action === "react");
      for (const { tx, hive } of decoded) {
        reactions.push({
          txHash: tx.hash,
          targetTxHash: String(hive.target ?? ""),
          type: String(hive.type ?? "agree") as "agree" | "disagree",
          author: tx.author,
          timestamp: tx.timestamp,
        });
      }
      return reactions;
    },

    async getRepliesTo(txHashes: string[]): Promise<import("./types.js").ScanPost[]> {
      if (!rpc.getTransactions || txHashes.length === 0) return [];

      const targets = new Set(txHashes);
      const replies: import("./types.js").ScanPost[] = [];
      const MAX_PAGES = 10;
      const PAGE_SIZE = 100;
      let start: number | "latest" = "latest";

      for (let page = 0; page < MAX_PAGES; page++) {
        const txs = await rpc.getTransactions(start, PAGE_SIZE);
        if (!txs || txs.length === 0) break;

        for (const rawTx of txs) {
          if (rawTx.type !== "storage") continue;
          try {
            const content = typeof rawTx.content === "string"
              ? safeParse(rawTx.content) as Record<string, unknown>
              : rawTx.content as Record<string, unknown>;
            const rawData = content?.data;
            const data = Array.isArray(rawData) && rawData[0] === "storage" ? rawData[1] : rawData;
            const hive = decodeHiveData(data);
            if (!hive || hive.action || !hive.text) continue;
            if (!hive.replyTo || !targets.has(String(hive.replyTo))) continue;

            replies.push({
              txHash: rawTx.hash,
              text: String(hive.text ?? ""),
              category: String(hive.cat ?? hive.category ?? ""),
              author: String(rawTx.from ?? content?.from ?? ""),
              timestamp: rawTx.timestamp ?? Number(content?.timestamp ?? 0),
              reactions: { agree: 0, disagree: 0 },
              reactionsKnown: false,
              tags: Array.isArray(hive.tags) ? hive.tags.map(String) : [],
              replyTo: String(hive.replyTo),
              blockNumber: rawTx.blockNumber,
            });
          } catch {
            // Skip malformed
          }
        }

        // Early exit: stop if we've found at least one reply per target
        if (page >= 1 && replies.length > 0) {
          const foundTargets = new Set(replies.map(r => r.replyTo).filter(Boolean));
          if (targets.size <= foundTargets.size) break;
        }

        const lastTx = txs[txs.length - 1];
        const prevStart = start;
        if (lastTx?.blockNumber != null && lastTx.blockNumber > 1) {
          start = lastTx.blockNumber - 1;
        } else break;
        if (start === prevStart) break;
      }

      return replies;
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

