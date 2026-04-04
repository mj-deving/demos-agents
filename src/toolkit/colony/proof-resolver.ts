/**
 * Proof resolver — resolves attestation txHashes on-chain to verify existence and extract proof data.
 *
 * Uses ChainReaderRpc.getTxByHash() to fetch full transaction content, then determines
 * attestation type (DAHR vs TLSN) from the transaction shape.
 *
 * DAHR: tx.content.type === "web2" — node-proxied request with responseHash
 * TLSN: tx.content.type === "storage" AND data contains proof structure (serverName/recv)
 */

import type { ChainReaderRpc } from "../chain-reader.js";
import type { AttestationMethod } from "../providers/types.js";

// ── Verification status constants ──────────────────────
export const CHAIN_UNRESOLVED = 0;
export const CHAIN_VERIFIED = 1;
export const CHAIN_FAILED = -1;

// ── Comparison tuning ──────────────────────────────────
/** Minimum fraction of snapshot values that must appear in TLSN response to count as "match" */
const SNAPSHOT_MATCH_THRESHOLD = 0.6;
/** Values shorter than this are skipped — avoids false positives from common short strings */
const MIN_VALUE_LENGTH = 3;
/** Max bytes of TLSN recv to store in chain_data (prevents unbounded memory from large responses) */
const MAX_RECV_STORED_BYTES = 4096;

// ── Failure reason union ───────────────────────────────
export type FailureReason =
  | "rpc_unavailable"
  | "rpc_error"
  | "tx_not_found"
  | "tx_not_confirmed"
  | "tx_no_content"
  | "unknown_attestation_type";

/** Permanent failures that should not be retried */
export const PERMANENT_FAILURES: ReadonlySet<FailureReason> = new Set([
  "tx_not_found",
  "tx_no_content",
  "unknown_attestation_type",
]);

export interface DahrProof {
  verified: true;
  method: "DAHR";
  /** Wallet address that created this attestation transaction. */
  txSender: string;
  sourceUrl: string;
  responseHash: string;
  timestamp: number;
  chainData: Record<string, unknown>;
}

export interface TlsnProof {
  verified: true;
  method: "TLSN";
  /** Wallet address that created this attestation transaction. */
  txSender: string;
  sourceUrl: string;
  responseData: string | null;
  notaryKey: string | null;
  timestamp: number;
  chainData: Record<string, unknown>;
}

export interface ResolutionFailure {
  verified: false;
  reason: FailureReason;
}

export type ResolutionResult = DahrProof | TlsnProof | ResolutionFailure;

function isDahrTransaction(content: Record<string, unknown>): boolean {
  if (content.type !== "web2") return false;
  const data = content.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return false;
  return !!data.url && !!(data.responseHash || data.hash);
}

function isTlsnProofData(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return "serverName" in obj && "recv" in obj;
}

function extractTlsnData(rawData: unknown, depth = 0): Record<string, unknown> | null {
  if (!rawData || depth > 3) return null;

  if (Array.isArray(rawData) && rawData[0] === "storage" && rawData[1]) {
    return extractTlsnData(rawData[1], depth + 1);
  }

  if (typeof rawData === "string") {
    try {
      const parsed = JSON.parse(rawData);
      if (isTlsnProofData(parsed)) return parsed;
    } catch {
      return null;
    }
  }

  if (typeof rawData === "object" && isTlsnProofData(rawData)) {
    return rawData as Record<string, unknown>;
  }

  return null;
}

/** Truncate recv field to prevent storing massive TLSN response bodies */
function truncateRecv(recv: unknown): string | null {
  if (recv == null) return null;
  const str = String(recv);
  return str.length > MAX_RECV_STORED_BYTES ? str.slice(0, MAX_RECV_STORED_BYTES) : str;
}

/**
 * Resolve a single attestation txHash against the chain.
 *
 * Returns typed proof data for DAHR or TLSN attestations,
 * or a failure with reason if the transaction doesn't exist or isn't a known type.
 */
export async function resolveAttestation(
  rpc: ChainReaderRpc,
  attestationTxHash: string,
): Promise<ResolutionResult> {
  if (!rpc.getTxByHash) {
    return { verified: false, reason: "rpc_unavailable" };
  }

  let tx;
  try {
    tx = await rpc.getTxByHash(attestationTxHash);
  } catch {
    return { verified: false, reason: "rpc_error" };
  }

  if (!tx) {
    return { verified: false, reason: "tx_not_found" };
  }

  if (tx.status !== "confirmed") {
    return { verified: false, reason: "tx_not_confirmed" };
  }

  const content = tx.content;
  if (!content) {
    return { verified: false, reason: "tx_no_content" };
  }

  if (isDahrTransaction(content)) {
    const data = (content.data ?? {}) as Record<string, unknown>;
    return {
      verified: true,
      method: "DAHR",
      txSender: String(content.from ?? ""),
      sourceUrl: String(data.url ?? ""),
      responseHash: String(data.responseHash ?? data.hash ?? ""),
      timestamp: (content.timestamp as number | undefined) ?? 0,
      chainData: data,
    };
  }

  if (content.type === "storage") {
    const proofData = extractTlsnData(content.data);
    if (proofData) {
      // Truncate recv to prevent storing multi-KB response bodies
      const { recv, ...rest } = proofData;
      return {
        verified: true,
        method: "TLSN",
        txSender: String(content.from ?? ""),
        sourceUrl: String(proofData.serverName ?? proofData.url ?? ""),
        responseData: proofData.recv != null ? String(proofData.recv) : null,
        notaryKey: proofData.notaryKey != null ? String(proofData.notaryKey) : null,
        timestamp: (proofData.time ?? content.timestamp ?? 0) as number,
        chainData: { ...rest, recv: truncateRecv(recv) },
      };
    }
  }

  return { verified: false, reason: "unknown_attestation_type" };
}

export type MatchStatus = "match" | "mismatch" | "partial" | "unverifiable";

/** Strip HTTP headers from TLSN recv data (split on \r\n\r\n, take body). */
function extractJsonBody(raw: string): string {
  const headerEnd = raw.indexOf("\r\n\r\n");
  return headerEnd >= 0 ? raw.slice(headerEnd + 4) : raw;
}

/** Collect all scalar values from a nested JSON object (depth-limited). */
function collectJsonScalars(obj: unknown, depth = 0, out?: Set<string>): Set<string> {
  const values = out ?? new Set<string>();
  if (depth > 4 || obj == null) return values;
  if (typeof obj !== "object") {
    const s = String(obj).toLowerCase();
    if (s.length >= MIN_VALUE_LENGTH) values.add(s);
    return values;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) collectJsonScalars(item, depth + 1, values);
  } else {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      collectJsonScalars(val, depth + 1, values);
    }
  }
  return values;
}

/** Structural key-value matching for JSON TLSN responses. Two phases:
 *  1. Key-based: checks parsed[key], parsed.data?.[key], parsed.result?.[key]
 *  2. Deep value: matches snapshot values against all JSON scalars (resists injection) */
function structuralMatch(
  parsed: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): { matchCount: number; total: number } {
  const entries = Object.entries(snapshot).filter(([, v]) => v != null && typeof v !== "object");
  if (entries.length === 0) return { matchCount: 0, total: 0 };

  let matchCount = 0;
  for (const [key, value] of entries) {
    const target = String(value).toLowerCase();
    const candidates = [
      parsed[key],
      (parsed.data as Record<string, unknown> | undefined)?.[key],
      (parsed.result as Record<string, unknown> | undefined)?.[key],
    ];
    if (candidates.some((c) => c != null && String(c).toLowerCase() === target)) matchCount++;
  }
  if (matchCount > 0) return { matchCount, total: entries.length };

  // Deep value matching: snapshot keys may not align with JSON keys.
  // Use separate total excluding short values to avoid inflating denominator.
  const jsonScalars = collectJsonScalars(parsed);
  let deepTotal = 0;
  for (const [, value] of entries) {
    const target = String(value).toLowerCase();
    if (target.length >= MIN_VALUE_LENGTH) {
      deepTotal++;
      if (jsonScalars.has(target)) matchCount++;
    }
  }
  return { matchCount, total: deepTotal || entries.length };
}

/**
 * Compare chain-resolved proof data against self-reported snapshot from the post.
 *
 * DAHR: existence on chain is sufficient (hash-level trust).
 * TLSN: structural JSON matching with substring fallback for non-JSON bodies.
 */
export function compareProofToSnapshot(
  resolved: DahrProof | TlsnProof,
  snapshot: Record<string, unknown> | null,
): { status: MatchStatus; details: string } {
  if (!snapshot) {
    return { status: "unverifiable", details: "no self-reported snapshot to compare" };
  }

  if (resolved.method === "DAHR") {
    return { status: "match", details: "DAHR attestation confirmed on chain" };
  }

  if (!resolved.responseData) {
    return { status: "partial", details: "TLSN proof on chain but no response data extractable" };
  }

  // Try structural JSON matching first (injection-resistant)
  const body = extractJsonBody(resolved.responseData);
  try {
    let parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) parsed = parsed[0];
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const { matchCount, total } = structuralMatch(parsed as Record<string, unknown>, snapshot);
      if (total === 0) return { status: "unverifiable", details: "snapshot has no comparable scalar values" };
      const matchRatio = matchCount / total;
      if (matchRatio >= SNAPSHOT_MATCH_THRESHOLD) {
        return { status: "match", details: `${matchCount}/${total} snapshot values structurally matched in TLSN response` };
      }
      if (matchRatio > 0) {
        return { status: "partial", details: `${matchCount}/${total} snapshot values structurally matched (below ${SNAPSHOT_MATCH_THRESHOLD * 100}% threshold)` };
      }
      return { status: "mismatch", details: "no snapshot values structurally matched in TLSN response" };
    }
  } catch {
    // Not valid JSON — fall through to substring matching
  }

  // Fallback: substring matching with MIN_VALUE_LENGTH guard (for non-JSON bodies)
  const responseStr = resolved.responseData.toLowerCase();
  const snapshotValues = Object.values(snapshot)
    .filter((v) => v != null && typeof v !== "object")
    .map((v) => String(v).toLowerCase());

  if (snapshotValues.length === 0) {
    return { status: "unverifiable", details: "snapshot has no comparable scalar values" };
  }

  const matchCount = snapshotValues.filter((v) => v.length >= MIN_VALUE_LENGTH && responseStr.includes(v)).length;
  const matchRatio = matchCount / snapshotValues.length;

  if (matchRatio >= SNAPSHOT_MATCH_THRESHOLD) {
    return { status: "match", details: `${matchCount}/${snapshotValues.length} snapshot values found in TLSN response` };
  }
  if (matchRatio > 0) {
    return { status: "partial", details: `${matchCount}/${snapshotValues.length} snapshot values found (below ${SNAPSHOT_MATCH_THRESHOLD * 100}% threshold)` };
  }
  return { status: "mismatch", details: "no snapshot values found in TLSN response data" };
}
