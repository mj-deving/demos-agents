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

  /** Query a transaction by hash to resolve sender address (RPC-based, trusted) */
  queryTransaction(txHash: string): Promise<{ sender: string } | null>;

  /** Get the underlying Demos instance (for direct SDK access when needed) */
  getDemos(): Demos;
}

// ── Factory ─────────────────────────────────────────

// HIVE post prefix (4 bytes: "HIVE")
const HIVE_PREFIX = new Uint8Array([0x48, 0x49, 0x56, 0x45]);

/**
 * Create a session-scoped SDK bridge.
 *
 * @param demos - Connected Demos instance (wallet already loaded)
 * @param apiBaseUrl - SuperColony API base URL
 * @param authToken - Authentication token for API calls
 * @param fetchImpl - Optional fetch implementation (for testing)
 * @param txModule - Optional DemosTransactions override (for testing)
 */
export function createSdkBridge(
  demos: Demos,
  apiBaseUrl: string,
  authToken: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  txModule?: TxModule,
  options?: { allowRawSdk?: boolean },
): SdkBridge {
  // Closure-scoped lazy loaders — avoids module-level shared mutable state
  let cachedTxModule: TxModule | null = txModule ?? null;
  let cachedD402Client: unknown = null;
  async function getTxModule(): Promise<TxModule> {
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
      const dahr = await (demos as any).web2.createDahr();
      const safeUrl = sanitizeUrl(url);

      // S13: 30s timeout on DAHR proxy (startProxy may hang indefinitely)
      let timeoutId: ReturnType<typeof setTimeout>;
      const proxyResponse = await Promise.race([
        dahr.startProxy({ url, method }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("DAHR proxy timeout (30s)")), 30_000);
        }),
      ]).finally(() => clearTimeout(timeoutId!));

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
          if (
            errLower.includes("unauthorized") ||
            errLower.includes("forbidden") ||
            errLower.includes("rate limit") ||
            errLower.includes("api key") ||
            errLower.includes("access denied")
          ) {
            throw new Error(`DAHR source returned error: "${errField}". URL: ${safeUrl}`);
          }
        }
      }

      return {
        responseHash: proxyResponse.responseHash,
        txHash: proxyResponse.txHash,
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
        console.warn(`[demos-toolkit] apiCall failed: ${message}`);
        return { ok: false, status: 0, data: message };
      }
    },

    async publishHivePost(post: HivePost): Promise<{ txHash: string }> {
      // Lazy-import DemosTransactions or use injected mock
      const tx = txModule ?? await getTxModule();

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

      // HIVE encode: 4-byte prefix + JSON
      const json = JSON.stringify(hivePost);
      const jsonBytes = new TextEncoder().encode(json);
      const encoded = new Uint8Array(HIVE_PREFIX.length + jsonBytes.length);
      encoded.set(HIVE_PREFIX, 0);
      encoded.set(jsonBytes, HIVE_PREFIX.length);

      // Store → Confirm → Broadcast
      const storeTx = await tx.store(encoded, demos);
      const validity = await tx.confirm(storeTx, demos);
      const result = await tx.broadcast(validity, demos);

      // Extract txHash (multiple SDK response shapes)
      const confirmHash = (validity as any)?.response?.data?.transaction?.hash;
      const results = (result as any)?.response?.results;
      const txHash = confirmHash
        || (results ? results[Object.keys(results)[0]]?.hash : undefined)
        || (result as any)?.response?.data?.transaction?.hash
        || (result as any)?.response?.data?.hash
        || (result as any)?.hash
        || (result as any)?.txHash;

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
      const result = await (demos as any).transfer(to, amount, memo);
      const txHash = result?.hash ?? result?.txHash;
      if (!txHash) {
        throw new Error("DEM transfer succeeded but txHash not found in response");
      }
      return { txHash: String(txHash) };
    },

    async payD402(requirement: D402PaymentRequirement): Promise<D402SettlementResult> {
      try {
        if (!cachedD402Client) {
          const { D402Client } = await import("@kynesyslabs/demosdk/d402/client");
          cachedD402Client = new D402Client(demos);
        }
        const client = cachedD402Client as { createPayment(req: unknown): Promise<unknown>; settle(payment: unknown): Promise<D402SettlementResult> };
        const payment = await client.createPayment(requirement);
        return await client.settle(payment);
      } catch (e) {
        if ((e as any)?.success === false) throw e; // already a D402SettlementResult-shaped error
        throw new Error(`D402 settlement failed: ${(e as Error).message}`);
      }
    },

    async queryTransaction(txHash: string): Promise<{ sender: string } | null> {
      try {
        const result = await (demos as any).queryTx(txHash);
        if (result?.sender) return { sender: String(result.sender) };
        // Try alternate SDK method
        const result2 = await (demos as any).getTx(txHash);
        if (result2?.sender) return { sender: String(result2.sender) };
        return null;
      } catch {
        return null;
      }
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

