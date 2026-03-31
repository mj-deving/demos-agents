import type { ColonyDatabase } from "./schema.js";

export function insertDeadLetter(
  db: ColonyDatabase,
  txHash: string,
  rawPayload: string,
  blockNumber: number,
  error: string,
): void {
  db.prepare(`
    INSERT INTO dead_letters (
      tx_hash, raw_payload, block_number, error, retry_count, first_failed_at
    ) VALUES (?, ?, ?, ?, 0, ?)
    ON CONFLICT(tx_hash) DO UPDATE SET
      raw_payload = excluded.raw_payload,
      block_number = excluded.block_number,
      error = excluded.error
  `).run(
    txHash,
    rawPayload,
    blockNumber,
    error,
    new Date().toISOString(),
  );
}

export function getRetryable(
  db: ColonyDatabase,
  maxRetries = 5,
): Array<{ txHash: string; rawPayload: string; retryCount: number }> {
  const rows = db.prepare(`
    SELECT tx_hash, raw_payload, retry_count
    FROM dead_letters
    WHERE retry_count < ?
    ORDER BY retry_count ASC, block_number ASC, tx_hash ASC
  `).all(maxRetries) as Array<{
    tx_hash: string;
    raw_payload: string;
    retry_count: number;
  }>;

  return rows.map((row) => ({
    txHash: row.tx_hash,
    rawPayload: row.raw_payload,
    retryCount: row.retry_count,
  }));
}

export function incrementRetry(db: ColonyDatabase, txHash: string): void {
  db.prepare(`
    UPDATE dead_letters
    SET retry_count = retry_count + 1
    WHERE tx_hash = ?
  `).run(txHash);
}

export function deleteDeadLetter(db: ColonyDatabase, txHash: string): void {
  db.prepare("DELETE FROM dead_letters WHERE tx_hash = ?").run(txHash);
}
