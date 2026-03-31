import type { ColonyDatabase } from "./schema.js";

export interface CachedSourceResponse {
  sourceId: string;
  url: string;
  lastFetchedAt: string;
  responseStatus: number;
  responseSize: number;
  responseBody: string;
  ttlSeconds: number;
  consecutiveFailures: number;
}

interface SourceResponseRow {
  source_id: string;
  url: string;
  last_fetched_at: string;
  response_status: number;
  response_size: number;
  response_body: string;
  ttl_seconds: number;
  consecutive_failures: number;
}

function mapSourceRow(row: SourceResponseRow | undefined): CachedSourceResponse | null {
  if (!row) {
    return null;
  }

  return {
    sourceId: row.source_id,
    url: row.url,
    lastFetchedAt: row.last_fetched_at,
    responseStatus: row.response_status,
    responseSize: row.response_size,
    responseBody: row.response_body,
    ttlSeconds: row.ttl_seconds,
    consecutiveFailures: row.consecutive_failures,
  };
}

function mapSourceRows(rows: SourceResponseRow[]): CachedSourceResponse[] {
  return rows.map((row) => mapSourceRow(row)).filter((row): row is CachedSourceResponse => row !== null);
}

export function upsertSourceResponse(db: ColonyDatabase, response: CachedSourceResponse): void {
  db.prepare(`
    INSERT INTO source_response_cache (
      source_id, url, last_fetched_at, response_status, response_size, response_body,
      ttl_seconds, consecutive_failures
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      url = excluded.url,
      last_fetched_at = excluded.last_fetched_at,
      response_status = excluded.response_status,
      response_size = excluded.response_size,
      response_body = excluded.response_body,
      ttl_seconds = excluded.ttl_seconds,
      consecutive_failures = excluded.consecutive_failures
  `).run(
    response.sourceId,
    response.url,
    response.lastFetchedAt,
    response.responseStatus,
    response.responseSize,
    response.responseBody,
    response.ttlSeconds,
    response.consecutiveFailures,
  );
}

export function getSourceResponse(db: ColonyDatabase, sourceId: string): CachedSourceResponse | null {
  const row = db.prepare(`
    SELECT
      source_id, url, last_fetched_at, response_status, response_size, response_body,
      ttl_seconds, consecutive_failures
    FROM source_response_cache
    WHERE source_id = ?
  `).get(sourceId) as SourceResponseRow | undefined;

  return mapSourceRow(row);
}

export function getFreshSources(db: ColonyDatabase, now: Date): CachedSourceResponse[] {
  const rows = db.prepare(`
    SELECT
      source_id, url, last_fetched_at, response_status, response_size, response_body,
      ttl_seconds, consecutive_failures
    FROM source_response_cache
    ORDER BY last_fetched_at DESC, source_id ASC
  `).all() as SourceResponseRow[];

  return mapSourceRows(rows).filter((source) => {
    const ageMs = now.getTime() - Date.parse(source.lastFetchedAt);
    return source.responseStatus >= 200
      && source.responseStatus < 300
      && source.consecutiveFailures < 3
      && ageMs <= source.ttlSeconds * 1000;
  });
}

export function getDegradedSources(db: ColonyDatabase, threshold = 3): CachedSourceResponse[] {
  const rows = db.prepare(`
    SELECT
      source_id, url, last_fetched_at, response_status, response_size, response_body,
      ttl_seconds, consecutive_failures
    FROM source_response_cache
    WHERE consecutive_failures >= ?
    ORDER BY consecutive_failures DESC, source_id ASC
  `).all(threshold) as SourceResponseRow[];

  return mapSourceRows(rows);
}

export function getUnfetchedSourceIds(db: ColonyDatabase, catalogSourceIds: string[]): string[] {
  if (catalogSourceIds.length === 0) {
    return [];
  }

  const placeholders = catalogSourceIds.map(() => "?").join(", ");
  const existingRows = db.prepare(`
    SELECT source_id
    FROM source_response_cache
    WHERE source_id IN (${placeholders})
  `).all(...catalogSourceIds) as Array<{ source_id: string }>;

  const existing = new Set(existingRows.map((row) => row.source_id));
  return catalogSourceIds.filter((sourceId) => !existing.has(sourceId));
}
