import { scanAddressStorage } from "./chain-scanner.js";
import { safeParse } from "./guards/state-helpers.js";
import { decodeHiveData } from "./hive-codec.js";
import type { HiveReaction, ScanPost } from "./types.js";

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
  if (!tx) return { confirmed: false };
  const confirmed = tx.blockNumber > 0 && tx.status === "confirmed";
  return {
    confirmed,
    blockNumber: tx.blockNumber,
    from: tx.content?.from,
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

    const lastTx = txs[txs.length - 1];
    const prevStart = start;
    if (lastTx?.blockNumber != null && lastTx.blockNumber > 1) {
      start = lastTx.blockNumber - 1;
    } else {
      break;
    }
    if (start === prevStart) break;
  }

  return posts.slice(0, limit);
}

export async function getHiveReactions(
  rpc: ChainReaderRpc,
  targetTxHashes: string[],
): Promise<Map<string, { agree: number; disagree: number }>> {
  const result = new Map<string, { agree: number; disagree: number }>();
  if (!rpc.getTransactions || targetTxHashes.length === 0) return result;

  const targets = new Set(targetTxHashes);
  for (const txHash of targets) {
    result.set(txHash, { agree: 0, disagree: 0 });
  }

  const MAX_PAGES = 10;
  const PAGE_SIZE = 100;
  let start: number | "latest" = "latest";

  for (let page = 0; page < MAX_PAGES; page++) {
    const txs = await rpc.getTransactions(start, PAGE_SIZE);
    if (!txs || txs.length === 0) break;

    for (const rawTx of txs) {
      if (rawTx.type !== "storage") continue;
      try {
        const { hive } = decodeRawHiveTransaction(rawTx);
        if (!hive || hive.action !== "react") continue;

        const target = String(hive.target ?? "");
        const reactionType = String(hive.type ?? "");
        if (!targets.has(target)) continue;

        const counts = result.get(target);
        if (!counts) continue;
        if (reactionType === "agree") counts.agree++;
        else if (reactionType === "disagree") counts.disagree++;
      } catch {
        // Skip malformed transactions.
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
}

export async function resolvePostAuthor(rpc: ChainReaderRpc, txHash: string): Promise<string | null> {
  try {
    if (!rpc.getTxByHash) return null;
    const tx = await rpc.getTxByHash(txHash);
    if (!tx?.content?.from) return null;
    return String(tx.content.from);
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

export async function getHiveReactionsByAuthor(
  rpc: ChainReaderRpc,
  address: string,
  options?: { limit?: number },
): Promise<HiveReaction[]> {
  const limit = options?.limit ?? 200;
  const reactions: HiveReaction[] = [];

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

    const lastTx = txs[txs.length - 1];
    const prevStart = start;
    if (lastTx?.blockNumber != null && lastTx.blockNumber > 1) {
      start = lastTx.blockNumber - 1;
    } else {
      break;
    }
    if (start === prevStart) break;
  }

  return replies;
}
