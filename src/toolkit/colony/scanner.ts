const MAX_DEAD_LETTER_RETRIES = 5;

import { safeParse } from "../guards/state-helpers.js";
import { decodeHiveData as decodeHivePayload } from "../hive-codec.js";
import { extractClaimsRegex } from "../publish/claim-extractor.js";
import { findSupportingAttestation, isClaimSupportedByAttestation } from "../publish/faithfulness-gate.js";
import type { PublishAttestation } from "../publish/types.js";
import { deleteDeadLetter, getRetryable, incrementRetry, insertDeadLetter } from "./dead-letters.js";
import { countPosts, getPost, insertPost } from "./posts.js";
import { getCursor, setCursor, type ColonyDatabase } from "./schema.js";
import { insertClaim } from "./claims.js";

export interface RawHivePost {
  txHash: string;
  author: string;
  blockNumber: number;
  timestamp: string;
  data: string;
}

export interface DecodedHivePost {
  txHash: string;
  author: string;
  blockNumber: number;
  timestamp: string;
  text: string;
  tags: string[];
  replyTo: string | null;
  attestations: Array<{
    txHash: string;
    url: string;
    method: "DAHR" | "TLSN";
    dataSnapshot?: Record<string, unknown>;
  }>;
  rawData: Record<string, unknown>;
}

export interface ScanResult {
  newPostCount: number;
  totalCached: number;
  cursor: number;
  deadLetterCount: number;
  claimsExtracted: number;
}

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const MENTION_RE = /(^|[^A-Za-z0-9_])@([A-Za-z0-9][A-Za-z0-9_-]{1,62})\b/g;

interface ScanCounters {
  newPostCount: number;
  claimsExtracted: number;
}

interface StoredDeadLetterPayload {
  txHash?: unknown;
  author?: unknown;
  blockNumber?: unknown;
  timestamp?: unknown;
  data?: unknown;
}

interface RawAttestationRecord {
  txHash: string;
  url: string;
  method: "DAHR" | "TLSN";
  dataSnapshot?: Record<string, unknown>;
}

function decodeRawPayload(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = safeParse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      const decoded = decodeHivePayload(parsed);
      if (decoded) return decoded;
      if (!Array.isArray(parsed)) return parsed as Record<string, unknown>;
    }
    return null;
  }

  return decodeHivePayload(raw);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const tags = value
    .map((entry) => typeof entry === "string" ? entry.trim().toLowerCase() : "")
    .filter((entry) => entry.length > 0);

  return [...new Set(tags)];
}

function normalizeReplyTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMethod(value: unknown): "DAHR" | "TLSN" {
  if (typeof value !== "string") return "DAHR";
  return value.toUpperCase() === "TLSN" ? "TLSN" : "DAHR";
}

function extractAttestations(payload: Record<string, unknown>): RawAttestationRecord[] {
  const rawAttestations = Array.isArray(payload.sourceAttestations)
    ? payload.sourceAttestations
    : Array.isArray(payload.attestations)
      ? payload.attestations
      : [];

  const attestations: RawAttestationRecord[] = [];
  for (const entry of rawAttestations) {
    const record = asRecord(entry);
    if (!record) continue;

    const txHash = typeof record.txHash === "string" ? record.txHash.trim() : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (txHash.length === 0 || url.length === 0) continue;

    const dataSnapshot = asRecord(record.dataSnapshot)
      ?? asRecord(record.data_snapshot)
      ?? asRecord(record.data)
      ?? undefined;

    attestations.push({
      txHash,
      url,
      method: normalizeMethod(record.method ?? record.type ?? record.attestationMethod ?? record.proofType),
      dataSnapshot,
    });
  }

  return attestations;
}

function inferSourceId(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function toPublishAttestations(
  attestations: RawAttestationRecord[],
  fallbackTimestamp: string,
): PublishAttestation[] {
  return attestations.map((attestation) => ({
    txHash: attestation.txHash,
    sourceId: inferSourceId(attestation.url),
    data: attestation.dataSnapshot ?? {},
    timestamp: fallbackTimestamp,
    method: attestation.method.toLowerCase() as PublishAttestation["method"],
  }));
}

function replaceAttestations(
  db: ColonyDatabase,
  postTxHash: string,
  attestations: RawAttestationRecord[],
  attestedAt: string,
): void {
  db.prepare("DELETE FROM attestations WHERE post_tx_hash = ?").run(postTxHash);

  const insert = db.prepare(`
    INSERT INTO attestations (
      post_tx_hash, attestation_tx_hash, source_url, method, data_snapshot, attested_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const attestation of attestations) {
    insert.run(
      postTxHash,
      attestation.txHash,
      attestation.url,
      attestation.method,
      attestation.dataSnapshot ? JSON.stringify(attestation.dataSnapshot) : null,
      attestedAt,
    );
  }
}

function replaceClaims(
  db: ColonyDatabase,
  rawPost: RawHivePost,
  decoded: DecodedHivePost,
): number {
  db.prepare("DELETE FROM claim_ledger WHERE post_tx_hash = ?").run(rawPost.txHash);

  const attestations = toPublishAttestations(decoded.attestations, rawPost.timestamp);
  const extracted = extractClaimsRegex(decoded.text).claims.filter((claim) => claim.type === "factual");

  for (const claim of extracted) {
    const supporting = findSupportingAttestation(claim, attestations);
    const attestation = supporting?.attestation ?? null;
    const verified = attestation ? isClaimSupportedByAttestation(claim, attestation) : false;
    const verificationResult = supporting
      ? verified
        ? "supported by attestation"
        : "attestation does not support claim"
      : "no supporting attestation found";

    insertClaim(db, {
      subject: claim.subject,
      metric: claim.identity.metric,
      value: claim.value,
      unit: claim.unit,
      direction: claim.direction,
      chain: claim.identity.chain,
      address: claim.identity.address,
      market: claim.identity.market,
      entityId: claim.identity.entityId,
      dataTimestamp: claim.dataTimestamp,
      postTxHash: rawPost.txHash,
      author: rawPost.author,
      claimedAt: rawPost.timestamp,
      attestationTxHash: attestation?.txHash ?? null,
      verified,
      verificationResult,
      stale: false,
    });
  }

  return extracted.length;
}

function totalDeadLetters(db: ColonyDatabase): number {
  return Number(db.prepare("SELECT COUNT(*) FROM dead_letters").pluck().get());
}

function processSingleRawPost(
  db: ColonyDatabase,
  rawPost: RawHivePost,
  counters: ScanCounters,
): void {
  try {
    const decoded = decodeHiveData(rawPost.data);
    if (!decoded) {
      throw new Error("failed to decode HIVE payload");
    }

    const existing = getPost(db, rawPost.txHash);
    if (!existing) {
      counters.newPostCount += 1;
    }

    const hydrated: DecodedHivePost = {
      ...decoded,
      txHash: rawPost.txHash,
      author: rawPost.author,
      blockNumber: rawPost.blockNumber,
      timestamp: rawPost.timestamp,
    };

    insertPost(db, {
      txHash: hydrated.txHash,
      author: hydrated.author,
      blockNumber: hydrated.blockNumber,
      timestamp: hydrated.timestamp,
      replyTo: hydrated.replyTo,
      tags: hydrated.tags,
      text: hydrated.text,
      rawData: hydrated.rawData,
    });

    replaceAttestations(db, rawPost.txHash, hydrated.attestations, rawPost.timestamp);
    counters.claimsExtracted += replaceClaims(db, rawPost, hydrated);
    deleteDeadLetter(db, rawPost.txHash);
    setCursor(db, Math.max(getCursor(db), rawPost.blockNumber));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    insertDeadLetter(db, rawPost.txHash, JSON.stringify(rawPost), rawPost.blockNumber, message);
  }
}

function parseDeadLetterPayload(payload: string, fallbackTxHash: string): RawHivePost | null {
  const parsed = safeParse(payload);
  const record = asRecord(parsed) as StoredDeadLetterPayload | null;
  if (!record) return null;

  if (typeof record.author !== "string"
    || typeof record.blockNumber !== "number"
    || typeof record.timestamp !== "string"
    || typeof record.data !== "string") {
    return null;
  }

  return {
    txHash: typeof record.txHash === "string" && record.txHash.trim().length > 0 ? record.txHash : fallbackTxHash,
    author: record.author,
    blockNumber: record.blockNumber,
    timestamp: record.timestamp,
    data: record.data,
  };
}

export function decodeHiveData(raw: string): DecodedHivePost | null {
  const payload = decodeRawPayload(raw);
  if (!payload || typeof payload.text !== "string" || payload.text.trim().length === 0) {
    return null;
  }
  if (payload.action !== undefined) {
    return null;
  }

  return {
    txHash: "",
    author: "",
    blockNumber: 0,
    timestamp: DEFAULT_TIMESTAMP,
    text: payload.text,
    tags: normalizeTags(payload.tags),
    replyTo: normalizeReplyTo(payload.replyTo ?? payload.reply_to),
    attestations: extractAttestations(payload),
    rawData: payload,
  };
}

export function extractMentions(text: string): string[] {
  const mentions = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    const handle = match[2]?.trim().toLowerCase();
    if (handle) mentions.add(handle);
  }
  return [...mentions];
}

export function processBatch(
  db: ColonyDatabase,
  rawPosts: RawHivePost[],
): ScanResult {
  const counters: ScanCounters = {
    newPostCount: 0,
    claimsExtracted: 0,
  };

  const process = db.transaction((posts: RawHivePost[]) => {
    for (const rawPost of posts) {
      processSingleRawPost(db, rawPost, counters);
    }
  });

  process(rawPosts);

  // Cursor tracks "seen through block N" — advances past dead-lettered posts.
  // Dead-letter queue handles retries separately (V3 design §5.5).
  if (rawPosts.length > 0) {
    const batchMaxBlock = Math.max(...rawPosts.map((post) => post.blockNumber));
    setCursor(db, Math.max(getCursor(db), batchMaxBlock));
  }

  return {
    newPostCount: counters.newPostCount,
    totalCached: countPosts(db),
    cursor: getCursor(db),
    deadLetterCount: totalDeadLetters(db),
    claimsExtracted: counters.claimsExtracted,
  };
}

export function retryDeadLetters(db: ColonyDatabase): number {
  let recovered = 0;

  for (const entry of getRetryable(db, MAX_DEAD_LETTER_RETRIES)) {
    let rawPost: RawHivePost | null = null;
    try {
      rawPost = parseDeadLetterPayload(entry.rawPayload, entry.txHash);
    } catch {
      rawPost = null;
    }

    if (!rawPost) {
      incrementRetry(db, entry.txHash);
      continue;
    }

    const before = totalDeadLetters(db);
    processBatch(db, [rawPost]);
    const after = totalDeadLetters(db);
    if (after < before) {
      recovered += 1;
    } else {
      incrementRetry(db, entry.txHash);
    }
  }

  return recovered;
}
