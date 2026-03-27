/**
 * Identity management — Web2 + cross-chain identity operations via Demos SDK.
 *
 * Bypasses @kynesyslabs/demosdk/abstraction (NAPI SIGSEGV crash) by using
 * DemosTransactions + Demos class directly. Same RPC operations, no native deps.
 *
 * Based on SDK source: Identities.inferIdentity() constructs an "identity" tx
 * with method "web2_identity_assign" or "xm_identity_assign_from_signature".
 */

import type { Demos } from "@kynesyslabs/demosdk/websdk";
import { DemosTransactions } from "@kynesyslabs/demosdk/websdk";
import { warn, info } from "../sdk.js";

// ── Hex Utilities ──────────────────────────────────

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Proof Generation ───────────────────────────────

/**
 * Create a Web2 proof payload string for identity verification.
 * The user posts this string publicly (tweet, gist), then submits the URL.
 * Format: demos:dw2p:{algorithm}:{signature_hex}
 */
export async function createWeb2ProofPayload(demos: Demos): Promise<string> {
  const message = "dw2p";
  const signature = await demos.crypto.sign(
    demos.algorithm,
    new TextEncoder().encode(message),
  );
  return `demos:${message}:${demos.algorithm}:${uint8ArrayToHex(signature.signature)}`;
}

// ── Identity Transactions ──────────────────────────

interface IdentityTxResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Submit an identity assignment transaction to the Demos network.
 * Constructs and signs an "identity" type tx, then confirms via RPC.
 */
async function submitIdentityTx(
  demos: Demos,
  context: "web2" | "xm",
  method: string,
  payload: Record<string, unknown>,
): Promise<IdentityTxResult> {
  try {
    const tx = DemosTransactions.empty();
    const ed25519 = await demos.crypto.getIdentity("ed25519");
    const address = uint8ArrayToHex(ed25519.publicKey);

    tx.content = {
      ...tx.content,
      type: "identity",
      to: address,
      amount: 0,
      data: [
        "identity",
        { context, method, payload },
      ],
      nonce: 1,
      timestamp: Date.now(),
    };

    const signedTx = await demos.sign(tx);
    const result = await demos.confirm(signedTx);
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Identity tx failed: ${message}` };
  }
}

// ── Twitter Identity ───────────────────────────────

/**
 * Link a Twitter identity to the connected Demos address.
 * Requires a public tweet containing the proof payload.
 *
 * @param demos Connected Demos instance
 * @param tweetUrl URL of the tweet containing the proof payload
 */
export async function addTwitterIdentity(
  demos: Demos,
  tweetUrl: string,
  agentName = "agent",
): Promise<IdentityTxResult> {
  try {
    // Resolve tweet data via Demos node
    const data = await demos.web2.getTweet(tweetUrl);
    if (!data.success) {
      return { ok: false, error: `Tweet verification failed: ${data.error}` };
    }
    if (!data.tweet?.userId || !data.tweet?.username) {
      return { ok: false, error: "Unable to get Twitter user info from tweet" };
    }

    info(`Linking Twitter @${data.tweet.username} to Demos address`, agentName);

    return await submitIdentityTx(demos, "web2", "web2_identity_assign", {
      context: "twitter",
      proof: tweetUrl,
      username: data.tweet.username,
      userId: data.tweet.userId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Twitter identity linking failed: ${message}`, agentName);
    return { ok: false, error: message };
  }
}

// ── GitHub Identity ────────────────────────────────

/**
 * Link a GitHub identity to the connected Demos address.
 * Requires a public gist containing the proof payload.
 *
 * @param demos Connected Demos instance
 * @param gistUrl URL of the GitHub gist containing the proof payload
 */
export async function addGithubIdentity(
  demos: Demos,
  gistUrl: string,
  agentName = "agent",
): Promise<IdentityTxResult> {
  const validPrefixes = [
    "https://gist.github.com",
    "https://raw.githubusercontent.com",
    "https://gist.githubusercontent.com",
  ];

  if (!validPrefixes.some(p => gistUrl.startsWith(p))) {
    return { ok: false, error: `Invalid GitHub gist URL. Must start with: ${validPrefixes.join(", ")}` };
  }

  try {
    info(`Linking GitHub gist to Demos address`, agentName);

    return await submitIdentityTx(demos, "web2", "web2_identity_assign", {
      context: "github",
      proof: gistUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`GitHub identity linking failed: ${message}`, agentName);
    return { ok: false, error: message };
  }
}

// ── Query Identities ───────────────────────────────

export interface LinkedIdentities {
  xm?: Record<string, unknown>;
  web2?: Record<string, unknown>;
}

/**
 * Query all linked identities for a Demos address via RPC.
 * Returns cross-chain (xm) and Web2 identities.
 */
export async function getIdentities(
  rpcUrl: string,
  address: string,
): Promise<{ ok: boolean; identities?: LinkedIdentities; error?: string }> {
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "getIdentities",
      params: [address],
      id: 1,
    });
    const response = await globalThis.fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { ok: false, error: `RPC error: HTTP ${response.status}` };
    }

    const json = await response.json() as {
      result?: LinkedIdentities;
      error?: { message?: string };
    };

    if (json.error) {
      return { ok: false, error: `RPC error: ${json.error.message ?? "unknown"}` };
    }

    return { ok: true, identities: json.result ?? {} };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Identity query failed: ${message}` };
  }
}

// ── Remove Identities ──────────────────────────────

/**
 * Remove a Web2 identity from the Demos address.
 */
export async function removeWeb2Identity(
  demos: Demos,
  context: string,
  username: string,
): Promise<IdentityTxResult> {
  return submitIdentityTx(demos, "web2", "web2_identity_remove", { context, username });
}
