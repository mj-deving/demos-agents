import type { ColonyDatabase } from "./schema.js";

export interface CachedClaim {
  id?: number;
  subject: string;
  metric: string;
  value: number | null;
  unit: string;
  direction: "up" | "down" | "stable" | null;
  chain: string;
  address: string | null;
  market: string | null;
  entityId: string | null;
  dataTimestamp: string | null;
  postTxHash: string;
  author: string;
  claimedAt: string;
  attestationTxHash: string | null;
  verified: boolean;
  verificationResult: string | null;
  stale: boolean;
}

interface ClaimRow {
  id: number;
  subject: string;
  metric: string;
  value: number | null;
  unit: string;
  direction: "up" | "down" | "stable" | null;
  chain: string;
  address: string | null;
  market: string | null;
  entity_id: string | null;
  data_timestamp: string | null;
  post_tx_hash: string;
  author: string;
  claimed_at: string;
  attestation_tx_hash: string | null;
  verified: number;
  verification_result: string | null;
  stale: number;
}

function mapClaimRow(row: ClaimRow): CachedClaim {
  return {
    id: row.id,
    subject: row.subject,
    metric: row.metric,
    value: row.value,
    unit: row.unit,
    direction: row.direction,
    chain: row.chain,
    address: row.address,
    market: row.market,
    entityId: row.entity_id,
    dataTimestamp: row.data_timestamp,
    postTxHash: row.post_tx_hash,
    author: row.author,
    claimedAt: row.claimed_at,
    attestationTxHash: row.attestation_tx_hash,
    verified: row.verified === 1,
    verificationResult: row.verification_result,
    stale: row.stale === 1,
  };
}

function mapClaimRows(rows: ClaimRow[]): CachedClaim[] {
  return rows.map((row) => mapClaimRow(row));
}

function getWindowEnd(since: string, windowMs: number): string {
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) {
    throw new Error(`Invalid ISO timestamp: ${since}`);
  }
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new Error(`Invalid windowMs: ${windowMs}`);
  }

  return new Date(sinceMs + windowMs).toISOString();
}

function getWindowClaims(
  db: ColonyDatabase,
  subject: string,
  metric: string,
  windowMs: number,
  since: string,
): CachedClaim[] {
  const until = getWindowEnd(since, windowMs);
  const rows = db.prepare(`
    SELECT
      id, subject, metric, value, unit, direction, chain, address, market, entity_id,
      data_timestamp, post_tx_hash, author, claimed_at, attestation_tx_hash, verified,
      verification_result, stale
    FROM claim_ledger
    WHERE subject = ?
      AND metric = ?
      AND claimed_at >= ?
      AND claimed_at <= ?
    ORDER BY claimed_at DESC, id DESC
  `).all(subject, metric, since, until) as ClaimRow[];

  return mapClaimRows(rows);
}

export function insertClaim(db: ColonyDatabase, claim: CachedClaim): number {
  const result = db.prepare(`
    INSERT INTO claim_ledger (
      subject, metric, value, unit, direction, chain, address, market, entity_id,
      data_timestamp, post_tx_hash, author, claimed_at, attestation_tx_hash, verified,
      verification_result, stale
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    claim.subject,
    claim.metric,
    claim.value,
    claim.unit,
    claim.direction,
    claim.chain,
    claim.address,
    claim.market,
    claim.entityId,
    claim.dataTimestamp,
    claim.postTxHash,
    claim.author,
    claim.claimedAt,
    claim.attestationTxHash,
    claim.verified ? 1 : 0,
    claim.verificationResult,
    claim.stale ? 1 : 0,
  );

  return Number(result.lastInsertRowid);
}

export function findDuplicateClaims(
  db: ColonyDatabase,
  subject: string,
  metric: string,
  windowMs: number,
  since: string,
): CachedClaim[] {
  return getWindowClaims(db, subject, metric, windowMs, since);
}

export function getClaimsByPost(db: ColonyDatabase, postTxHash: string): CachedClaim[] {
  const rows = db.prepare(`
    SELECT
      id, subject, metric, value, unit, direction, chain, address, market, entity_id,
      data_timestamp, post_tx_hash, author, claimed_at, attestation_tx_hash, verified,
      verification_result, stale
    FROM claim_ledger
    WHERE post_tx_hash = ?
    ORDER BY claimed_at ASC, id ASC
  `).all(postTxHash) as ClaimRow[];

  return mapClaimRows(rows);
}

export function getClaimsByAuthor(db: ColonyDatabase, author: string, limit?: number): CachedClaim[] {
  const query = limit === undefined
    ? `
      SELECT
        id, subject, metric, value, unit, direction, chain, address, market, entity_id,
        data_timestamp, post_tx_hash, author, claimed_at, attestation_tx_hash, verified,
        verification_result, stale
      FROM claim_ledger
      WHERE author = ?
      ORDER BY claimed_at DESC, id DESC
    `
    : `
      SELECT
        id, subject, metric, value, unit, direction, chain, address, market, entity_id,
        data_timestamp, post_tx_hash, author, claimed_at, attestation_tx_hash, verified,
        verification_result, stale
      FROM claim_ledger
      WHERE author = ?
      ORDER BY claimed_at DESC, id DESC
      LIMIT ?
    `;

  const rows = (limit === undefined
    ? db.prepare(query).all(author)
    : db.prepare(query).all(author, limit)) as ClaimRow[];

  return mapClaimRows(rows);
}

export function findContradictions(
  db: ColonyDatabase,
  subject: string,
  metric: string,
  windowMs: number,
  since: string,
): CachedClaim[] {
  const claims = getWindowClaims(db, subject, metric, windowMs, since);
  const distinctAssertions = new Set(
    claims.map((claim) => JSON.stringify([claim.value, claim.unit, claim.direction])),
  );

  return distinctAssertions.size > 1 ? claims : [];
}
