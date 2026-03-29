import { safeParse } from "./guards/state-helpers.js";
import { decodeHiveData } from "./hive-codec.js";

export interface DecodedTx {
  tx: {
    hash: string;
    blockNumber: number;
    author: string;
    timestamp: number;
  };
  hive: Record<string, unknown>;
}

/**
 * Scan an address's storage transactions and decode HIVE payloads.
 * Uses getTransactionHistory (server-side filter) when available, falls back to getTransactions + client-side filter.
 * The `filter` predicate controls which decoded HIVE entries are included (posts vs reactions).
 */
export async function scanAddressStorage(
  rpc: {
    getTransactionHistory?(address: string, type?: string, options?: { start?: number; limit?: number }): Promise<Array<{
      hash: string;
      blockNumber: number;
      status: string;
      content: { from: string; to: string; type: string; data: unknown; timestamp: number };
    }>>;
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
  },
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
            tx: {
              hash: tx.hash,
              blockNumber: tx.blockNumber,
              author: tx.content?.from ? String(tx.content.from) : address,
              timestamp: tx.content?.timestamp ?? 0,
            },
            hive: decoded,
          });
        } catch {
          console.warn("[demos-toolkit] Skipping malformed storage transaction from getTransactionHistory");
        }
      }

      const lastTx = txs[txs.length - 1];
      if (lastTx?.blockNumber != null && lastTx.blockNumber > 1) {
        const nextStart = lastTx.blockNumber - 1;
        if (nextStart === start) break;
        start = nextStart;
      } else {
        break;
      }
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
            : rawTx.content as unknown as Record<string, unknown>;
          const rawData = content?.data;
          const data = Array.isArray(rawData) && rawData[0] === "storage" ? rawData[1] : rawData;
          const decoded = decodeHiveData(data);
          if (!decoded || !filter(decoded)) continue;
          results.push({
            tx: {
              hash: rawTx.hash,
              blockNumber: rawTx.blockNumber,
              author: String(rawTx.from ?? content?.from ?? address),
              timestamp: rawTx.timestamp ?? Number(content?.timestamp ?? 0),
            },
            hive: decoded,
          });
        } catch {
          console.warn("[demos-toolkit] Skipping malformed storage transaction from getTransactions");
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
  }

  return results;
}
