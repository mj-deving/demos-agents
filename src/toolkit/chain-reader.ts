import { scanAddressStorage } from "./chain-scanner.js";
import { safeParse } from "./guards/state-helpers.js";
import { decodeHiveData } from "./hive-codec.js";
import type { ScanPost } from "./types.js";

interface ChainTxByHash {
  hash: string;
  blockNumber: number;
  status: string;
  content: {
    from: string;
    to: string;
    type: string;
    data: unknown;
    timestamp: number;
  };
}

interface ChainRawTransaction {
  /** Global transaction index — used as `start` param for getTransactions pagination */
  id: number;
  hash: string;
  blockNumber: number;
  status: string;
  from: string;
  to: string;
  type: string;
  content: string;
  timestamp: number;
}

export interface ChainReaderRpc {
  getTxByHash?(txHash: string): Promise<ChainTxByHash>;
  getTransactions?(start?: number | "latest", limit?: number): Promise<ChainRawTransaction[]>;
  getTransactionHistory?(address: string, type?: string, options?: { start?: number; limit?: number }): Promise<Array<{
    hash: string;
    blockNumber: number;
    status: string;
    content: { from: string; to: string; type: string; data: unknown; timestamp: number };
  }>>;
}

function isChainTxByHash(value: unknown): value is ChainTxByHash {
  if (!value || typeof value !== "object") return false;
  const tx = value as Partial<ChainTxByHash>;
  return typeof tx.hash === "string"
    && typeof tx.blockNumber === "number"
    && typeof tx.status === "string";
}

async function findRecentTransactionByHash(
  rpc: ChainReaderRpc,
  txHash: string,
  limit: number = 100,
): Promise<ChainRawTransaction | null> {
  if (!rpc.getTransactions) return null;
  const txs = await rpc.getTransactions("latest", limit);
  if (!Array.isArray(txs)) return null;
  return txs.find((tx) => tx?.hash === txHash) ?? null;
}

function decodeRawHiveTransaction(rawTx: ChainRawTransaction): { content: Record<string, unknown>; hive: Record<string, unknown> | null } {
  const content = typeof rawTx.content === "string"
    ? safeParse(rawTx.content) as Record<string, unknown>
    : rawTx.content as unknown as Record<string, unknown>;
  const rawData = content?.data;
  const data = Array.isArray(rawData) && rawData[0] === "storage" ? rawData[1] : rawData;
  return { content, hive: decodeHiveData(data) };
}

function toScanPost(rawTx: ChainRawTransaction, content: Record<string, unknown>, hive: Record<string, unknown>): ScanPost {
  return {
    txHash: rawTx.hash,
    text: String(hive.text ?? ""),
    category: String(hive.cat ?? hive.category ?? ""),
    author: String(rawTx.from ?? content.from ?? ""),
    timestamp: rawTx.timestamp ?? Number(content.timestamp ?? 0),
    reactions: { agree: 0, disagree: 0 },
    reactionsKnown: false,
    tags: Array.isArray(hive.tags) ? hive.tags.map(String) : [],
    replyTo: hive.replyTo ? String(hive.replyTo) : undefined,
    blockNumber: rawTx.blockNumber,
  };
}

export async function verifyTransaction(
  rpc: ChainReaderRpc,
  txHash: string,
): Promise<{ confirmed: boolean; blockNumber?: number; from?: string } | null> {
  if (!rpc.getTxByHash) return null;

  const tx = await rpc.getTxByHash(txHash);
  if (isChainTxByHash(tx)) {
    const confirmed = tx.blockNumber > 0 && tx.status === "confirmed";
    return {
      confirmed,
      blockNumber: tx.blockNumber,
      from: tx.content?.from,
    };
  }

  const fallback = await findRecentTransactionByHash(rpc, txHash);
  if (!fallback) return { confirmed: false };
  const confirmed = fallback.blockNumber > 0 && fallback.status === "confirmed";
  return {
    confirmed,
    blockNumber: fallback.blockNumber,
    from: fallback.from,
  };
}

export async function getHivePosts(rpc: ChainReaderRpc, limit: number): Promise<ScanPost[]> {
  if (!rpc.getTransactions) return [];

  const MAX_PAGES = 5;
  const PAGE_SIZE = 100;
  const posts: ScanPost[] = [];
  let start: number | "latest" = "latest";

  for (let page = 0; page < MAX_PAGES && posts.length < limit; page++) {
    const txs = await rpc.getTransactions(start, PAGE_SIZE);
    if (!txs || txs.length === 0) break;

    for (const rawTx of txs) {
      if (rawTx.type !== "storage") continue;
      try {
        const { content, hive } = decodeRawHiveTransaction(rawTx);
        if (!hive || hive.action) continue;
        posts.push(toScanPost(rawTx, content, hive));
      } catch {
        // Skip malformed transactions.
      }
    }

    // Paginate backward using transaction id (global index), NOT blockNumber.
    // SDK's getTransactions(start) treats start as a tx index, not a block number.
    const lastTx = txs[txs.length - 1];
    const prevStart: number | "latest" = start;
    if (lastTx?.id != null && lastTx.id > 1) {
      start = lastTx.id - PAGE_SIZE;
      if (start < 1) start = 1;
    } else {
      break;
    }
    if (start === prevStart) break;
  }

  return posts.slice(0, limit);
}

export async function resolvePostAuthor(rpc: ChainReaderRpc, txHash: string): Promise<string | null> {
  try {
    if (!rpc.getTxByHash) return null;
    const tx = await rpc.getTxByHash(txHash);
    if (isChainTxByHash(tx) && tx.content?.from) {
      return String(tx.content.from);
    }
    const fallback = await findRecentTransactionByHash(rpc, txHash);
    if (!fallback?.from) return null;
    return String(fallback.from);
  } catch {
    return null;
  }
}

export async function getHivePostsByAuthor(
  rpc: ChainReaderRpc,
  address: string,
  options?: { limit?: number },
): Promise<ScanPost[]> {
  const limit = options?.limit ?? 200;
  const posts: ScanPost[] = [];

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
}

export async function getRepliesTo(rpc: ChainReaderRpc, txHashes: string[]): Promise<ScanPost[]> {
  if (!rpc.getTransactions || txHashes.length === 0) return [];

  const targets = new Set(txHashes);
  const replies: ScanPost[] = [];
  const MAX_PAGES = 10;
  const PAGE_SIZE = 100;
  let start: number | "latest" = "latest";

  for (let page = 0; page < MAX_PAGES; page++) {
    const txs = await rpc.getTransactions(start, PAGE_SIZE);
    if (!txs || txs.length === 0) break;

    for (const rawTx of txs) {
      if (rawTx.type !== "storage") continue;
      try {
        const { content, hive } = decodeRawHiveTransaction(rawTx);
        if (!hive || hive.action || !hive.text) continue;
        if (!hive.replyTo || !targets.has(String(hive.replyTo))) continue;
        replies.push(toScanPost(rawTx, content, hive));
      } catch {
        // Skip malformed.
      }
    }

    if (page >= 1 && replies.length > 0) {
      const foundTargets = new Set(replies.map((reply) => reply.replyTo).filter(Boolean));
      if (targets.size <= foundTargets.size) break;
    }

    // Paginate backward using transaction id (global index), NOT blockNumber.
    const lastTx = txs[txs.length - 1];
    const prevStart: number | "latest" = start;
    if (lastTx?.id != null && lastTx.id > 1) {
      start = lastTx.id - PAGE_SIZE;
      if (start < 1) start = 1;
    } else {
      break;
    }
    if (start === prevStart) break;
  }

  return replies;
}
